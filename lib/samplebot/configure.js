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
const deepEqual = require("deep-equal");
const validateResource = require("@tradle/validate-resource");
const constants_1 = require("./constants");
const serverlessYml = require("../cli/serverless-yml");
const Errors = require("../errors");
const { reinitializeOnConfChanged } = serverlessYml.custom;
class Conf {
    constructor(bot) {
        this.getPrivateConf = () => this.privateConfBucket.getJSON(constants_1.PRIVATE_CONF_KEY);
        this.getPublicConf = () => this.publicConfBucket.getJSON(constants_1.PUBLIC_CONF_KEY);
        this.savePublicConf = (value, reinitializeContainers = true) => __awaiter(this, void 0, void 0, function* () {
            yield this.putIfDifferent({
                bucket: this.publicConfBucket,
                key: constants_1.PUBLIC_CONF_KEY,
                value,
                reinitializeContainers
            });
        });
        this.savePrivateConf = (value, reinitializeContainers = true) => __awaiter(this, void 0, void 0, function* () {
            yield this.putIfDifferent({
                bucket: this.privateConfBucket,
                key: constants_1.PRIVATE_CONF_KEY,
                value,
                reinitializeContainers
            });
        });
        this.forceReinitializeContainers = () => this.bot.forceReinitializeContainers(reinitializeOnConfChanged);
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
        this.putIfDifferent = ({ bucket, key, value, reinitializeContainers }) => __awaiter(this, void 0, void 0, function* () {
            const willPut = yield hasDifferentValue({ bucket, key, value });
            if (willPut) {
                yield bucket.put(key, value);
                if (reinitializeContainers) {
                    yield this.forceReinitializeContainers();
                }
            }
        });
        this.bot = bot;
        const { buckets } = bot.resources;
        this.privateConfBucket = buckets.PrivateConf;
        this.publicConfBucket = buckets.PublicConf;
    }
}
exports.Conf = Conf;
exports.createConf = (bot) => new Conf(bot);
const hasDifferentValue = ({ bucket, key, value }) => __awaiter(this, void 0, void 0, function* () {
    try {
        const current = yield bucket.get(key);
        return !deepEqual(current, value);
    }
    catch (err) {
        Errors.ignore(err, Errors.NotFound);
        return true;
    }
});
//# sourceMappingURL=configure.js.map