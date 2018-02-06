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
const models_1 = require("@tradle/models");
const validateResource = require("@tradle/validate-resource");
const _1 = require("./");
const configure_1 = require("./configure");
const Errors = require("../errors");
const allowNotFound = err => {
    Errors.ignore(err, Errors.NotFound);
    return undefined;
};
function customize(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        let { lambda, bot, delayReady, event, conf } = opts;
        if (!bot)
            bot = lambda.bot;
        const { logger } = lambda || bot;
        const confy = configure_1.createConf({ bot });
        let [botConf, modelsPack, style, termsAndConditions] = yield Promise.all([
            (conf && conf.bot) ? Promise.resolve(conf.bot) : confy.botConf.get().catch(allowNotFound),
            (conf && conf.modelsPack) ? Promise.resolve(conf.modelsPack) : confy.modelsPack.get().catch(allowNotFound),
            (conf && conf.style) ? Promise.resolve(conf.style) : confy.style.get().catch(allowNotFound),
            (conf && conf.termsAndConditions)
                ? Promise.resolve({ value: conf.termsAndConditions })
                : confy.termsAndConditions.getDatedValue()
                    .then(datedValue => datedValue.value && datedValue)
                    .catch(allowNotFound)
        ]);
        if (modelsPack) {
            bot.modelStore.setCustomModels(modelsPack);
        }
        if (style) {
            try {
                validateResource({ models: models_1.models, resource: style });
            }
            catch (err) {
                bot.logger.error('invalid style', err.stack);
                style = null;
            }
        }
        conf = {
            bot: botConf,
            style,
            termsAndConditions,
            modelsPack
        };
        const components = _1.default({
            bot,
            logger,
            conf,
            event
        });
        if (!opts.delayReady)
            bot.ready();
        return Object.assign({}, components, { conf,
            style });
    });
}
exports.customize = customize;
//# sourceMappingURL=customize.js.map