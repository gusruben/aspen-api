const axios = require("axios").default;
const { JSDOM } = require("jsdom");

class Aspen {
    rootURL;
    cookies = {};
    strutsToken; // apache struts token (org.apache.struts.taglib.html.TOKEN)
    userAgent = new UserAgent().toString();

    /**
     * Creates the Aspen session object, and logs in using the supplied username/password
     * @param {Object} options The session options
     * @param {String} options.username The username to use to sign in to Aspen
     * @param {String} options.password The password to use to sign in to Aspen
     * @param {String} options.id The ID of the Aspen instance to access, in {id}.myfollett.com
     */
    constructor(options) {
        // set base url
        this.rootURL = `https://${options.id}.myfollett.com`;

        // initial request to create a new JSESSIONID cookie, which is needed
        // for the rest of the requests (not part of the login, though), and to
        // get the Apache Struts HTML token (something else it uses to log in)
        axios.get(this.rootURL).then((resp) => {
            // extract JSESSIONID cookie (as well as non-necessary cookies)
            resp.headers["set-cookie"].forEach((cookie) => {
                // split at first equal sign
                let cookieSplit = cookie.split(/=(.*)/s);
                // strip everything after first ';'
                let cookieData = cookieSplit[1].split(";")[0];
                this.cookies[cookieSplit[0]] = cookieData;
            });

            // create dom object to extract apache struts token from form
            const dom = new JSDOM(resp.data);
            this.strutsToken = dom.window.document.querySelector(
                "[name='org.apache.struts.taglib.html.TOKEN']"
            ).value;
        });
    }
}

module.exports = Aspen;
