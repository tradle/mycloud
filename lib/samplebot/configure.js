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
const utils_1 = require("../utils");
const { reinitializeOnConfChanged } = serverlessYml.custom;
class Conf {
    constructor(bot) {
        this.get = (forceFetch) => __awaiter(this, void 0, void 0, function* () {
            const results = yield utils_1.allSettled([
                this.getPrivateConf(),
                this.getPublicConf(),
                this.getStyles(),
                this.getCustomModels()
            ]);
            const [privateConf, publicConf, styles, customModels] = results.map(r => value);
            return {
                privateConf,
                publicConf,
                styles,
                customModels
            };
        });
        this.getCustomModels = (forceFetch) => __awaiter(this, void 0, void 0, function* () {
            return this.customModels.get({ force: forceFetch });
        });
        this.getStyles = (forceFetch) => __awaiter(this, void 0, void 0, function* () {
            return this.styles.get({ force: forceFetch });
        });
        this.getPrivateConf = (forceFetch) => __awaiter(this, void 0, void 0, function* () {
            return this.privateConf.get({ force: forceFetch });
        });
        this.getPublicConf = (forceFetch) => __awaiter(this, void 0, void 0, function* () {
            return this.publicConf.get({ force: forceFetch });
        });
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
        const { buckets } = bot;
        this.privateConfBucket = buckets.PrivateConf;
        this.publicConfBucket = buckets.PublicConf;
        this.publicConf = this.publicConfBucket.getCacheable({
            ttl: 60000,
            key: constants_1.PUBLIC_CONF_KEY,
            parse: JSON.parse.bind(JSON)
        });
        this.privateConf = this.privateConfBucket.getCacheable({
            ttl: 60000,
            key: constants_1.PRIVATE_CONF_KEY,
            parse: JSON.parse.bind(JSON)
        });
        this.customModels = this.privateConfBucket.getCacheable({
            ttl: 60000,
            key: constants_1.CUSTOM_MODELS_KEY,
            parse: JSON.parse.bind(JSON)
        });
        this.styles = this.privateConfBucket.getCacheable({
            ttl: 60000,
            key: constants_1.STYLES_KEY,
            parse: JSON.parse.bind(JSON)
        });
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