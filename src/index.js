const axios = require("axios").default;
const { JSDOM } = require("jsdom");
const { HeaderGenerator, PRESETS } = require("header-generator");

class Aspen {
    cookies;
    session; // axios session

    /**
     * Creates the Aspen session object, and logs in using the supplied username/password
     * @param {Object} options The session options
     * @param {String} options.username The username to use to sign in to Aspen
     * @param {String} options.password The password to use to sign in to Aspen
     * @param {String} options.id The ID of the Aspen instance to access, in {id}.myfollett.com
     */
    constructor(options) {
        // initialize axios http session ('instance), this doesn't store cookies
        // or anything like that, just repeats the same config automatically
        this.session = axios.create({
            baseURL: `https://${options.id}.myfollett.com/`,
            headers: new HeaderGenerator(
                PRESETS.MODERN_WINDOWS_CHROME
            ).getHeaders(),
        });

        // initial request to create a new JSESSIONID cookie, which is needed
        // for the rest of the requests (not part of the login, though), and to
        // get the Apache Struts HTML token (something else it uses to log in)
        this.session.get("/").then(resp => {
            // get initial cookies
            this.cookies = resp.headers["set-cookie"];

            // create dom object to extract additional form fields
            const dom = new JSDOM(resp.data);
            const form =
                dom.window.document.querySelector("[name='logonForm']");
            const formData = new dom.window.FormData(form);

            // set the login values in the form data
            formData.set("deploymentId", "dcps");
            formData.set("username", options.username);
            formData.set("password", options.password);

            // create form parameters for the login form
            const loginParams = new URLSearchParams(formData);
            // this doesn't need to do anything with the output, server-side
            // aspen will give the JSESSIONID cookie more permissions and stuff
            this.session
                .post(
                    "/aspen/logon.do",
                    loginParams,
                    {
                        headers: {
                            Connection: "keep-alive",
                            Pragma: "no-cache",
                            "Cache-Control": "no-cache",
                            "Upgrade-Insecure-Requests": "1",
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36",
                            Cookie: this.cookies,
                        },
                    }
                )
                .catch(err => {
                    console.log(err);
                });
        });
    }
}

module.exports = Aspen;
