"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const constants_1 = require("@tradle/constants");
const DEFAULT_CONF = require('./form-prefills.json');
exports.name = 'prefillForm';
function createPlugin({ conf = DEFAULT_CONF, logger }) {
    const willRequestForm = ({ to, application, formRequest }) => {
        const appSpecific = application && conf[application.requestFor];
        const { form, prefill } = formRequest;
        if (prefill)
            return;
        let values;
        if (appSpecific) {
            values = appSpecific[form];
        }
        if (!values) {
            values = conf[form];
        }
        if (values) {
            logger.debug(`set prefill on form request for: ${form}`);
            formRequest.prefill = _.extend({
                [constants_1.TYPE]: form
            }, values);
        }
    };
    return {
        willRequestForm
    };
}
exports.createPlugin = createPlugin;
//# sourceMappingURL=prefill-form.js.map