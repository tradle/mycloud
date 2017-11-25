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
const validateResource = require("@tradle/validate-resource");
const constants_1 = require("./constants");
class Conf {
    constructor(bot) {
        this.getPrivateConf = () => this.privateConfBucket.getJSON(constants_1.PRIVATE_CONF_KEY);
        this.getPublicConf = () => this.publicConfBucket.getJSON(constants_1.PUBLIC_CONF_KEY);
        this.savePublicConf = (value, reinitializeContainers = true) => __awaiter(this, void 0, void 0, function* () {
            yield this.publicConfBucket.put(constants_1.PUBLIC_CONF_KEY, value);
            if (reinitializeContainers) {
                yield this.forceReinitializeContainers();
            }
        });
        this.savePrivateConf = (value, reinitializeContainers = true) => __awaiter(this, void 0, void 0, function* () {
            yield this.privateConfBucket.put(constants_1.PRIVATE_CONF_KEY, value);
            if (reinitializeContainers) {
                yield this.forceReinitializeContainers();
            }
        });
        this.forceReinitializeContainers = () => this.bot.forceReinitializeContainers();
        this.setStyle = (style, reinitializeContainers = true) => __awaiter(this, void 0, void 0, function* () {
            yield this.bot.promiseReady();
            validateResource({
                models: this.bot.models,
                model: 'tradle.StylesPack',
                resource: style
            });
            const publicConf = yield this.getPublicConf();
            publicConf.style = style;
            yield this.savePublicConf(publicConf, reinitializeContainers);
        });
        this.bot = bot;
        const { buckets } = bot.resources;
        this.privateConfBucket = buckets.PrivateConf;
        this.publicConfBucket = buckets.PublicConf;
    }
}
exports.Conf = Conf;
exports.createConf = (bot) => new Conf(bot);
//# sourceMappingURL=configure.js.map