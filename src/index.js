const axios = require("axios").default;
const { JSDOM } = require("jsdom");
const { HeaderGenerator, PRESETS } = require("header-generator");

/** A class representing an Aspen session */
class Aspen {
    session; // axios session
    classPage; // JSDOM object with the class list page, for sending form data

    /**
     * Creates the Aspen session object
     * @param {String} id The ID of the Aspen instance to access, in {id}.myfollett.com
     */
    constructor(id) {

        // initialize axios http session ('instance), this doesn't store cookies
        // or anything like that, just repeats the same config automatically
        this.session = axios.create({
            baseURL: `https://${id}.myfollett.com:443`,
            headers: new HeaderGenerator(
                PRESETS.MODERN_WINDOWS_CHROME
            ).getHeaders(),
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
        const initialResponse = await this.session.get("/");

        // get initial cookies
        this.session.defaults.headers["Cookie"] =
            initialResponse.headers["set-cookie"];

        // create dom object to extract additional form fields
        const dom = new JSDOM(initialResponse.data);
        const form = dom.window.document.querySelector("[name='logonForm']");
        const formData = new dom.window.FormData(form);

        // set the login values in the form data
        formData.set("deploymentId", "dcps");
        formData.set("username", options.username);
        formData.set("password", options.password);

        // create form parameters for the login form
        const loginParams = new URLSearchParams(formData);
        // this doesn't need to do anything with the output, server-side
        // aspen will give the JSESSIONID cookie more permissions and stuff
        await this.session.post("/aspen/logon.do", loginParams);
    }

    /**
     * Gets a list of all the classes, along with data about them.
     *
     * @returns {Array} The array of classes
     */
    async getClasses() {
        const resp = await this.session.get(
            "/aspen/portalClassList.do?navkey=academics.classes.list"
        );
        this.classPage = new JSDOM(resp.data).window;

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
            "absences", // amount of absences
            "tardies", // amount of tardies
            null, // unknown, header is 'Dsm' but all are zero,
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
        if (!this.classPage) {
            this.classPage = new JSDOM(
                await this.session.get(
                    "/aspen/portalClassList.do?navkey=academics.classes.list"
                )
            ).window;
        }

        const form = new this.classPage.FormData(
            this.classPage.document.querySelector("[name='classListForm']")
        );

        form.set("userEvent", 2100); // userEvent ID for getting class info (i think)
        form.set("userParam", token); // userParam has the class token
        const params = new URLSearchParams(form);

        // the request for the class detail page
        const doc = new JSDOM(
            (await this.session.post("/aspen/portalClassList.do", params)).data
        ).window.document;
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
}

module.exports = Aspen;
