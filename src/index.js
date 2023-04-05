import got from "got";
import { CookieJar } from "tough-cookie";
import { JSDOM } from "jsdom";
import { HeaderGenerator, PRESETS } from "header-generator";

/** A class representing an Aspen session */
class Aspen {
    api; // Got session
    instanceId; // the ID of the aspen instance
    cookieJar; // cookies
    classPage; // JSDOM object with the class list page, for sending form data

    /**
     * Creates the Aspen session object
     * @param {String} id The ID of the Aspen instance to access, in {id}.myfollett.com
     */
    constructor(id) {
        this.instanceId = id;
        this.cookieJar = new CookieJar();
        // initialize Got http session ('instance), this  just repeats the same config automatically
        this.api = got.extend({
            prefixUrl: `https://${id}.myfollett.com/aspen`,
            headers: new HeaderGenerator(
                PRESETS.MODERN_WINDOWS_CHROME
            ).getHeaders(),
            cookieJar: this.cookieJar,
        });
    }

    /**
     * Initializes the Aspen session object, and authenticates with Aspen in using the supplied username/password
     * @param {Object} options The session options
     * @param {String} options.username The username to use to sign in to Aspen
     * @param {String} options.password The password to use to sign in to Aspen
     */
    async login(options) {
        // initial request to create a new JSESSIONID cookie, which is needed
        // for the rest of the requests (not part of the login, though), and to
        // get the Apache Struts HTML token (something else it uses to log in)
        const initialResponse = await this.api.get("logon.do");

        // get initial cookies and add them to the cookie jar
        for (let cookie of initialResponse.headers["set-cookie"]) {
            await this.cookieJar.setCookie(
                cookie,
                `https://${this.instanceId}.myfollett.com`
            );
        }

        // create dom object to extract additional form fields
        const dom = new JSDOM(initialResponse.body);
        const form = dom.window.document.querySelector("[name='logonForm']");
        const formData = new dom.window.FormData(form);

        // set the login values in the form data
        formData.set("deploymentId", "dcps");
        formData.set("username", options.username);
        formData.set("password", options.password);

        // create form parameters for the login form (converted to a raw JSON object)
        const loginParams = Object.fromEntries(new URLSearchParams(formData));

        // this doesn't need to do anything with the output, server-side
        // aspen will give the JSESSIONID cookie more permissions and stuff
        try {
            await this.api.post("logon.do", {
                cookieJar: this.cookieJar,
                form: loginParams,
            });
        } catch (err) {
            // because of what might be a Got bug, when the server redirects to /aspen/home.do, got
            // will send a POST request instead of a GET request (to /aspen/home.do). This will
            // cause the server to respond with a 502 error, but we can just ignore that. If it's
            // another error, though, we'll throw it anyway, because something else went wrong
            if (err.code != "ERR_NON_2XX_3XX_RESPONSE") {
                throw err;
            }
        }
    }

    /**
     * Gets a list of all the classes, along with data about them.
     *
     * @returns {Array} The array of classes
     */
    async getClasses() {
        const resp = await this.api.get(
            "portalClassList.do?navkey=academics.classes.list"
        );
        this.classPage = new JSDOM(resp.body).window;

        // which values in the table row correspond to what fields
        const classDataFields = [
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

        const classListData = []; // output list with all the classes
        for (const classRow of this.classPage.document.querySelectorAll(
            "#dataGrid .listCell"
        )) {
            const classData = {}; // output object for this class

            const children = Array.from(classRow.children);
            children.forEach((elem, i) => {
                const field = classDataFields[i];
                if (!field) return; // if the field is null (not good data), skip it

                let data = elem.textContent.trim();
                // special cases for some values
                if (field == "token") {
                    // if it's the token, extract it from the ID of the input element
                    data = elem.children[1].id;
                }
                if (field === "grade") {
                    // extract number grade and letter grade seperately
                    let grade = data.split(" ");
                    data = Number(grade[0]);
                    classData["letterGrade"] = grade[1];
                }

                // check if the string is parseable as a number
                if (!isNaN(data) && !isNaN(parseFloat(data))) {
                    data = Number(data);
                }

                classData[field] = data;
            });

            classListData.push(classData);
        }

        return classListData;
    }

    /**
     * Gets data about a class, including grades.
     * @param {String} token The token of the class (similar to an ID), from the getClasses() function
     * @returns An object containing data about the class
     */
    async getClass(token) {
        // after sending this request, all of the following requests will
        // automatically relate to the class, even though they don't have the token
        const html = await this.#loadClass(token);

        // the request for the class detail page
        const doc = new JSDOM(html).window.document;
        const classData = {
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
        let metadataElems = Array.from(
            doc.querySelectorAll(
                "#collapsibleDiv0  tr:nth-child(2) td.detailValue"
            )
        );
        metadataElems.forEach((elem, i) => {
            if (metadataFields[i]) {
                // ignore null
                classData[metadataFields[i]] = elem.textContent.trim();
            }
        });

        // attendance data
        const attendanceFields = ["absent", "tardy", "dismissed"]; // the fields in the table
        // #dataGridLeft is the attendance table
        let attendanceRows = Array.from(
            doc.querySelectorAll("#dataGridLeft tr.listCell")
        );
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
                    if (elem.textContent.trim()) {
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

    async getAssignments(token) {
        // after sending this request, all of the following requests will
        // automatically relate to the class, even though they don't have the token
        await this.#loadClass(token);

        // output variable
        const assignmentData = [];

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

        Array.from(rows).forEach((row, rowIndex) => {
            assignmentData[rowIndex] = {};

            Array.from(row.children).forEach((elem, columnIndex) => {
                let field = assignmentFields[columnIndex];
                if (!field) return; // ignore 'null'

                // variable for the data inside that element, there are some special cases
                let data = elem.textContent.trim();

                // special cases
                if (field == "grade") {
                    // inside the grade column is another table, with three rows,
                    // each for different values
                    // if there's only 1 row, it's ungraded
                    if (elem.querySelectorAll("td").length == 1) {
                        data =
                            assignmentData[rowIndex].score =
                            assignmentData[rowIndex].points =
                                elem.textContent.trim();
                    } else {
                        Array.from(elem.querySelectorAll("td")).forEach(
                            (gradeElem, i) => {
                                // the first element is the grade %
                                if (i == 0) {
                                    data = Number(
                                        gradeElem.textContent
                                            .trim()
                                            .slice(0, -1)
                                    );

                                    // the second element is the points out of the total
                                } else if (i == 1) {
                                    assignmentData[rowIndex].score =
                                        gradeElem.textContent.trim();

                                    // the third elem is the points, or 'WS' if it's missin
                                } else if (i == 2) {
                                    let points = gradeElem.textContent
                                        .trim()
                                        .slice(1, -1); // cut off the parenthesis

                                    // if it's a number
                                    if (
                                        !isNaN(points) &&
                                        !isNaN(parseFloat(points))
                                    ) {
                                        assignmentData[rowIndex].points =
                                            Number(points);
                                    } else {
                                        // otherwise just set the string
                                        assignmentData[rowIndex].points =
                                            points;
                                    }
                                }
                            }
                        );
                    }
                }

                assignmentData[rowIndex][field] = data;
            });
        });

        return assignmentData;
    }

    /**
     *
     * @param {String} token the id ('token') of the class
     * @returns {String} the HTML of the class's page
     */
    async #loadClass(token) {
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
            this.classPage.document.querySelector("[name='classListForm']")
        );

        form.set("userEvent", 2100); // userEvent ID for getting class info (i think)
        form.set("userParam", token); // userParam has the class token
        const params = new URLSearchParams(form);

        return (await this.api.post("portalClassList.do", params)).body;
    }
}

export default Aspen;
