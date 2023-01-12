const axios = require("axios").default;
const { JSDOM } = require("jsdom");
const { HeaderGenerator, PRESETS } = require("header-generator");

/** A class representing an Aspen session */
class Aspen {
    session; // axios session

    /**
     * Creates the Aspen session object
     * @param {String} id The ID of the Aspen instance to access, in {id}.myfollett.com
     */
    constructor(id) {
        // initialize axios http session ('instance), this doesn't store cookies
        // or anything like that, just repeats the same config automatically
        this.session = axios.create({
            baseURL: `https://${id}.myfollett.com/`,
            headers: new HeaderGenerator(PRESETS.MODERN_WINDOWS_CHROME).getHeaders(),
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
        this.session.defaults.headers["Cookie"] = initialResponse.headers["set-cookie"];

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
        const dom = new JSDOM(resp.data);

        // which values in the table row correspond to what fields
        const classDataFields = [
            null, // checkbox
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
            null, // unknown, header is 'Dsm' but all are zero
        ];

        const classListData = [];
        for (const classRow of dom.window.document.querySelectorAll("#dataGrid .listCell")) {
            const classData = {}
            const children = Array.from(classRow.children);
            children.forEach((elem, i) => {
                const field = classDataFields[i];
                if (!field) return; // if the field is null (not good data), skip it

                let data = elem.textContent.trim();
                // special cases for some values
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

            classListData.push(classData)
        }

        return classListData;
    }
}

module.exports = Aspen;
