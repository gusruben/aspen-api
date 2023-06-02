import got, { Got, HTTPError, RequestError, Response } from "got";
import { Cookie, CookieJar } from "tough-cookie";
import { JSDOM } from "jsdom";
import {
	HeaderGenerator,
	HeaderGeneratorOptions,
	PRESETS,
} from "header-generator";
import { DOMWindow } from "jsdom";
import { Assignment, ClassData, ClassInfo, Day, Period, Schedule } from "./types.js";

/** A class representing an Aspen session */
class Aspen {
	api: Got; // Got session
	instanceId: string; // the ID of the aspen instance
	cookieJar: CookieJar; // cookies
	classPage: DOMWindow; // JSDOM object with the class list page, for sending form data

	/**
	 * Creates the Aspen session object
	 * @param {String} id The ID of the Aspen instance to access, in {id}.myfollett.com
	 */
	constructor(id: string, cookies?: Cookie[]) {
		this.instanceId = id;
		this.cookieJar = new CookieJar();

		// if cookies is set, then use that to fill the cookie jar
		for (let cookie of cookies || []) {
			this.cookieJar.setCookieSync(cookie, `https://${id}.myfollett.com`);
		}

		// initialize Got http session ('instance'), this  just repeats the same config automatically
		this.api = got.extend({
			prefixUrl: `https://${id}.myfollett.com/aspen`,
			headers: new HeaderGenerator(
				PRESETS.MODERN_WINDOWS_CHROME as Partial<HeaderGeneratorOptions>
			).getHeaders(),
			cookieJar: this.cookieJar,
			methodRewriting: true,
		});
	}

	/**
	 * Initializes the Aspen session object, and authenticates with Aspen in using the supplied username/password
	 * @param {Object} options The session options
	 * @param {String} options.username The username to use to sign in to Aspen
	 * @param {String} options.password The password to use to sign in to Aspen
	 */
	async login(options: { username: string; password: string }) {
		// initial request to create a new JSESSIONID cookie, which is needed
		// for the rest of the requests (not part of the login, though), and to
		// get the Apache Struts HTML token (something else it uses to log in)
		const initialResponse = await this.api.get("logon.do");

		// get initial cookies and add them to the cookie jar
		for (let cookie of initialResponse.headers["set-cookie"] ?? []) {
			await this.cookieJar.setCookie(
				cookie,
				`https://${this.instanceId}.myfollett.com`
			);
		}

		// create dom object to extract additional form fields
		const dom = new JSDOM(initialResponse.body);
		const form = dom.window.document.querySelector(
			"[name='logonForm']"
		) as HTMLFormElement;
		const formData = new dom.window.FormData(form);

		// set the login values in the form data
		formData.set("deploymentId", "dcps");
		formData.set("username", options.username);
		formData.set("password", options.password);

		// create form parameters for the login form (converted to a raw JSON object)
		const loginParams = Object.fromEntries(formData);

		// we don't need to do anything with the output of this, server-side
		// aspen will give the JSESSIONID cookie more permissions and stuff
		let res: Response<string>;
		try {
			res = await this.api.post("logon.do", {
				cookieJar: this.cookieJar,
				form: loginParams,
			});
		} catch (e) {
			if (e instanceof RequestError) {
				throw new Error("Unable to connect to Aspen")
			} else if (e instanceof HTTPError && e.code == "ERR_NON_2XX_3XX_RESPONSE") {
				throw new Error("Aspen returned 500 Server Error")
			} else {
				throw e;
			}
		}

		// check if the login failed for any reason, this doesn't need full JSDOM
		// parsing, we can just use `.includes()`
		if (res.body.includes("Invalid login.")) {
			throw new Error("Invalid Aspen username or password")
		} else if (res.body.includes("Not logged on")) {
			throw new Error("Invalid Aspen session")
		}
	}

	/**
	 * Gets a list of all the classes, along with data about them.
	 *
	 * @returns {Promise<ClassInfo[]>} The array of classes
	 */
	async getClasses(): Promise<ClassInfo[]> {
		const resp = await this.api.get(
			"portalClassList.do?navkey=academics.classes.list"
		);
		this.classPage = new JSDOM(resp.body).window;

		// which values in the table row correspond to what fields
		const classDataFields: (keyof ClassInfo | null)[] = [
			"token", // checkbox, with the ID / 'token' for the course (used for getting data)
			"name", // course name
			"course", // course id
			"term", // what term the course lasts for, FY for full year
			"teacher", // teacher name (first, last)
			"email", // teacher email
			"classroom", // class room number
			null, // the column header is 'Name', but it has the name of my school? useless info either way
			"grade", // number grade, letterGrade is set manually in the loop
			"absent", // amount of absences
			"tardy", // amount of tardies
			"dismissed", // amount of 'dismissed' [absences?]
		];

		const classListData: ClassInfo[] = []; // output list with all the classes
		for (const classRow of this.classPage.document.querySelectorAll(
			"#dataGrid .listCell"
		)) {
			// this should be a Partial<ClassInfo>, but when I do that, I get some really weird errors
			// because I know that the types are going to be safe, I can set it as `any` and convert
			// it to a ClassInfo later (once it's all filled).
			const classInfo: any = {}; // output object for this class

			const children = Array.from(classRow.children);
			children.forEach((elem, i) => {
				const field = classDataFields[i] as keyof ClassInfo;
				if (!field) return; // if the field is null (not good data), skip it

				let data: string | number = (elem.textContent as string).trim();
				// special cases for some values
				if (field == "token") {
					// if it's the token, extract it from the ID of the input element
					data = elem.children[1].id;
				}
				if (field === "grade") {
					// extract number grade and letter grade seperately
					let grade = data.split(" ");
					data = Number(grade[0]);
					classInfo["letterGrade"] = grade[1];
				}

				// check if the string is parseable as a number
				if (
					!isNaN(data as number) &&
					!isNaN(parseFloat(data as string))
				) {
					data = Number(data);
				}

				// let x = classInfo[field]
				classInfo[field] = data;
			});

			classListData.push(classInfo as ClassInfo);
		}

		return classListData;
	}

	/**
	 * Gets data about a class, including grades.
	 * @param {String} token The token of the class (similar to an ID), from the getClasses() function
	 * @returns {Promise<ClassData>} An object containing data about the class
	 */
	async getClass(token: string): Promise<ClassData> {
		// after sending this request, all of the following requests will
		// automatically relate to the class, even though they don't have the token
		const html = await this.#loadClass(token);

		// the request for the class detail page
		const doc = new JSDOM(html).window.document;
		// once gain, this needs to be `any` so that typescript is happy
		// it gets converted to ClassData once it's full
		const classData: any = {
			attendance: {},
			grades: {
				1: { weights: {} },
				2: { weights: {} },
				3: { weights: {} },
				4: { weights: {} },
			},
		}; // output object

		// metadata (teacher, room #, etc)
		const metadataFields = ["teacher", "email", "room"]; // null fields are for labels
		let metadataElems = doc.querySelectorAll(
			"#collapsibleDiv0  tr:nth-child(2) td.detailValue"
		);
		metadataElems.forEach((elem, i) => {
			if (metadataFields[i]) {
				// ignore null
				classData[metadataFields[i]] = elem.textContent?.trim();
			}
		});

		// attendance data
		const attendanceFields = ["absent", "tardy", "dismissed"]; // the fields in the table
		// #dataGridLeft is the attendance table
		let attendanceRows = doc.querySelectorAll("#dataGridLeft tr.listCell");
		attendanceRows.forEach((row, rowIndex) => {
			// create an object called 'absent', 'tardy', or 'dismissed' based on the index
			let currentField = attendanceFields[rowIndex];
			classData.attendance[currentField] = {};
			Array.from(row.children)
				.slice(1) // skip the labels
				.forEach((elem, valIndex) => {
					// loop through values, skipping the label
					let term;
					if (valIndex == 4) {
						term = "total"; // 4th column is the total for all terms
					} else {
						term = valIndex;
					}
					classData.attendance[currentField][term] = Number(
						elem.textContent
					);
				});
		});

		// grades data
		// fields for eachh of the tables and sub-tables, created using multiple variables
		// so that there's less repeated stuff
		const gradeCategories = [
			"assessments",
			"participation",
			"practiceAndApplication",
		];
		let gradeRows = Array.from(
			doc.querySelectorAll("#dataGridRight tr.listCell")
		).slice(0, -1); // cut off the last 2 rows, 'Gradebook Average' and 'Last Posted Grade' (calculated manually)
		gradeRows.forEach((row, rowIndex) => {
			// loop through each value in the row
			Array.from(row.children)
				.slice(1) // exclude the first label
				.forEach((elem, term) => {
					// term is the term for these values
					// extract the value
					let val = null;
					if (elem.textContent?.trim()) {
						val = Number.parseFloat(
							elem.textContent.trim().slice(0, -1) // strip off % sign on the end
						);
					}

					let gradeCategory =
						gradeCategories[Math.floor(rowIndex / 2)];

					// even rows have the weight of the category for each term, odd
					// rows have the actual grades for that category for each term

					// weight
					if (rowIndex % 2 == 0) {
						// weight rows have an additional label at the beginning for
						// the category, this skips that (but keeps `i` consistent)
						term--;
						if (term == -1) {
							// term will be -1 for whatever was at index 0, e.g. the label
							return;
						}

						// set the value in the output object
						classData.grades[term + 1].weights[gradeCategory] = val;
					} else {
						// grade rows ("Avg" on the Aspen page)
						classData.grades[term + 1][gradeCategory] = val;
					}
				});
		});

		// add in totals / averages for each of the terms
		Object.keys(classData.grades).forEach((termId, i) => {
			const term = classData.grades[termId];

			classData.grades[termId].total =
				(term.assessments * term.weights.assessments + // assessments
					term.participation * term.weights.participation + // participation
					term.practiceAndApplication * // practice and application
						term.weights.practiceAndApplication) /
				100;
		});

		return classData;
	}

	/**
	 * Gets the list of assignments from a class.
	 * @param {String} token The token of the class (similar to an ID), from the getClasses() function
	 * @returns {Promise<Assignment[]>} A list containing the assignments of the class
	 */
	async getAssignments(token: string): Promise<Assignment[]> {
		// after sending this request, all of the following requests will
		// automatically relate to the class, even though they don't have the token
		await this.#loadClass(token);

		// output variable
		const assignmentData: Partial<Assignment>[] = [];

		// get the assignments page
		const resp = await this.api.get(
			"portalAssignmentList.do?navkey=academics.classes.list.gcd"
		);
		const page = new JSDOM(resp.body).window;

		// row in a table for each of the assignments
		const rows = page.document.querySelectorAll("#dataGrid tr.listCell");

		// map from what fields in a table row are what fields in the output var
		const assignmentFields = [
			null, // checkbox
			"name",
			"dateAssigned",
			"dateDue",
			"schedule", // for some reason, what days of the week that class is?
			"grade", // special, has 3 values (percentage, score, and points), see code for more info
			"feedback",
		];

		rows.forEach((row, rowIndex) => {
			assignmentData[rowIndex] = {};

			Array.from(row.children).forEach((elem, columnIndex) => {
				let field = assignmentFields[columnIndex];
				if (!field) return; // ignore 'null'

				// variable for the data inside that element, there are some special cases
				let data: number | string = elem.textContent?.trim() as string;

				// special cases
				if (field == "grade") {
					// inside the grade column is another table, with three rows,
					// each for different values
					// if there's only 1 row, it's ungraded
					if (elem.querySelectorAll("td").length == 1) {
						data =
							assignmentData[rowIndex].score =
							assignmentData[rowIndex].points =
								"Ungraded";
					} else {
						elem.querySelectorAll("td").forEach((gradeElem, i) => {
							// the first element is the grade %
							if (i == 0) {
								data = Number(
									gradeElem.textContent?.trim().slice(0, -1)
								);

								// the second element is the points out of the total
							} else if (i == 1) {
								assignmentData[rowIndex].score =
									gradeElem.textContent?.trim();

								// the third elem is the points, or 'WS' if it's missin
							} else if (i == 2) {
								let points = gradeElem.textContent
									?.trim()
									.slice(1, -1) as string; // cut off the parenthesis

								assignmentData[rowIndex].points =
									Number(points);
							}
						});
					}
				}

				// this is a bit of a dumb hack
				// typescript isn't sure that field is a key of Partial<Assignment>
				// and for some reason it won't accept it if we tell it that it is
				// so we have to convert the Partial<Assignment> (which is assignmentData[rowIndex])
				// to `any`, then we can set the property
				(assignmentData[rowIndex] as any)[field] = data;
			});
		});

		return assignmentData as Assignment[];
	}

	/**
	 * Gets the current schedule of the current student
	 * @returns {Promise<Schedule>} The student's current schedule, as a JSON
	 */
	async getSchedule(): Promise<Schedule> {
		// this function needs to send an initial request to get Aspen to be happy loading the schedule
		// we want the 'matrix' version of the schedule, as it's slightly easier to parse and has some
		// more info
		await this.api.get(
			"studentScheduleContextList.do?navkey=myInfo.sch.list"
		);

		const schedulePage = await this.api.get(
			"studentScheduleMatrix.do?navkey=myInfo.sch.matrix"
		);

		const page = new JSDOM(schedulePage.body).window;

		// create an initial objetc, where each key is a day and the value is an array of the
		// classes on that day
		const schedule: Partial<Schedule> = {
			currentDay: null,
			currentClass: null,
		};

		// initialize the 'day' keys in the object by getting them from the page (using the page is)
		// necessary to work with systems like 'friday 1' and 'friday 2'
		const headers = page.document.querySelectorAll(
			".inputGridHeader.inputGridColumnHeader"
		);
		headers.forEach(header => {
			// for whatever reason, innerText isn't implemented in JSDOM
			const dayID = header.textContent?.trim().split(/\s/g)[0] as Day; // the format is 'ID - Name', ex: "M - Monday"

			// if it's the current day (specified by the element having a red border), set that
			// in the schedule object
			if (header.getAttribute("style")?.includes("red")) {
				schedule.currentDay = dayID;
			}

			schedule[dayID] = [];
		});

		// this is the list of values that each entry in the schedule table stores. They are
		// separated by <br>.
		const classDataKeys = [
			"course", // course ID
			"name", // course name
			"teacher", // teacher name
			"room", // room #
		];

		// loop through each of the columns in the table, by selecting td elements that are the
		// first child, then the second child, etc. Note that it actually starts by selecting the
		// second child, because the first column is just the period number. Starting with the
		// second child also ignores any other random tables scattered across the page with only one
		// element.

		// get a static copy before the loop so that when 'currentClass' is set it doesn't break
		const safeSchedule = { ...schedule };
		// also remove these to not cause issues
		delete safeSchedule.currentDay;
		delete safeSchedule.currentClass;

		for (let i = 0; i < Object.keys(safeSchedule).length; i++) {
			const day = Object.keys(safeSchedule)[i] as Day; // the code for the day

			const dayClasses = page.document.querySelectorAll(
				`.listGridFixed td:nth-child(${i + 2}) td`
			);
			// for each of the classes, fill out the data
			for (const classElem of dayClasses) {
				const rawClassData = classElem.innerHTML.trim().split("<br>");
				// this is a Partial<Period> (or just a Period), but we once again need to make it
				// `any` until it has been filled, because otherwise typescript will get angry
				const periodData: any = {};

				// this loop fills the data into the classData variable, with the respective keys
				classDataKeys.forEach((key, index) => {
					periodData[key] = rawClassData[index];
				});

				// if it's the current period, set it in classData and schedule (it'll have a red
				// border if it's the current period)
				if (
					classElem.parentElement?.parentElement?.parentElement
						?.parentElement?.style.border
				) {
					periodData.currentPeriod = true;
					schedule.currentClass = periodData;
				} else {
					periodData.currentPeriod = false;
				}

				// add the class to the main schedule object (for the current day)
				(schedule[day] as Period[]).push(periodData);
			}
		}

		return schedule as Schedule;
	}

	/**
	 * Requests a class's page to switch Aspen's 'focus'
	 * @param {String} token the id ('token') of the class
	 * @returns {String} the HTML of the class's page
	 */
	async #loadClass(token: string): Promise<string> {
		// class list page has a form on it to select the class
		if (!this.classPage) {
			const resp = await this.api.get(
				"portalClassList.do?navkey=academics.classes.list"
			);
			this.classPage = new JSDOM(resp.body).window;
		}

		// sending this form with the class token 'selects' the class, so that
		// the following requests will be in relation to that class (even though
		// the requests don't have information relating to that class)
		const form = new this.classPage.FormData(
			this.classPage.document.querySelector(
				"[name='classListForm']"
			) as HTMLFormElement
		);

		form.set("userEvent", "2100"); // userEvent ID for getting class info (i think)
		form.set("userParam", token); // userParam has the class token
		const params = Object.fromEntries(form);

		return (await this.api.post("portalClassList.do", { form: params }))
			.body;
	}

	/**
	 * Gets a list of all the stored cookies
	 * @returns {Promise<Cookie[]>} The cookies that Aspen is using
	 */
	async getCookies(): Promise<Cookie[]>  {
		return await this.cookieJar.getCookies(`https://${this.instanceId}.myfollett.com/aspen`);
	}
}

export default Aspen;
