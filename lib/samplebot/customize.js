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
const strategy_1 = require("./strategy");
const configure_1 = require("./configure");
const ONFIDO_PLUGIN_PATH = 'products.plugins.onfido';
function customize(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const { bot, delayReady, event } = opts;
        let conf = yield configure_1.createConf(bot).getPrivateConf();
        const onfido = dotProp.get(conf, ONFIDO_PLUGIN_PATH);
        const components = strategy_1.default({ bot, conf, event });
        if (!opts.delayReady)
            bot.ready();
        return Object.assign({}, components, { conf });
    });
}
exports.customize = customize;
//# sourceMappingURL=customize.js.map