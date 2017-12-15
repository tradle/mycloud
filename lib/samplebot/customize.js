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
const dotProp = require("dot-prop");
const models_1 = require("@tradle/models");
const validateResource = require("@tradle/validate-resource");
const strategy_1 = require("./strategy");
const configure_1 = require("./configure");
const Errors = require("../errors");
const ONFIDO_PLUGIN_PATH = 'products.plugins.onfido';
function customize(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const { bot, delayReady, event } = opts;
        const confy = configure_1.createConf({ bot });
        let [org, conf, customModels, style] = yield Promise.all([
            confy.org.get(),
            confy.botConf.get(),
            confy.models.get().catch(err => {
                Errors.ignore(err, Errors.NotFound);
            }),
            confy.style.get().catch(err => {
                Errors.ignore(err, Errors.NotFound);
            })
        ]);
        const { domain } = org;
        const namespace = domain.split('.').reverse().join('.');
        const onfido = dotProp.get(conf, ONFIDO_PLUGIN_PATH);
        if (style) {
            try {
                validateResource({ models: models_1.models, resource: style });
            }
            catch (err) {
                bot.logger.error('invalid style', err.stack);
                style = null;
            }
        }
        const components = strategy_1.default({
            bot,
            namespace,
            conf,
            customModels,
            style,
            event
        });
        if (!opts.delayReady)
            bot.ready();
        return Object.assign({}, components, { conf,
            org });
    });
}
exports.customize = customize;
//# sourceMappingURL=customize.js.map