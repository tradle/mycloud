"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
exports.createPlugin = ({ conf, logger }) => {
    const willRequestForm = ({ to, application, formRequest }) => {
        const appSpecific = application && conf[application.requestFor];
        const { form } = formRequest;
        let lens;
        if (appSpecific) {
            lens = appSpecific[form];
        }
        if (!lens) {
            lens = conf[form];
        }
        if (lens) {
            logger.debug(`updated lens on form request for: ${form}`);
            formRequest.lens = lens;
        }
    };
    return {
        willRequestForm
    };
};
exports.validateConf = ({ conf, pluginConf }) => __awaiter(this, void 0, void 0, function* () {
    const modelsPack = yield conf.modelStore.getCumulativeModelsPack({ force: true });
    const { lenses = [] } = modelsPack || [];
    const lensesById = _.groupBy(lenses, 'id');
    for (let type in pluginConf) {
        let vals = pluginConf[type];
        for (let subType in vals) {
            let lensId = vals[subType];
            if (lensId) {
                let lens = lensesById[lensId];
                if (!lens)
                    throw new Error(`missing lens: ${lensId}`);
            }
        }
    }
});
//# sourceMappingURL=lens.js.map