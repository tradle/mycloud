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
    constructor({ tradle }) {
        this.getPrivateConf = () => this.privateConf.get();
        this.getPublicConf = () => this.publicConf.get();
        this.savePublicConf = (value) => {
            return this.publicConf.put({ value });
        };
        this.savePrivateConf = (value) => {
            return this.privateConf.put({ value });
        };
        this.setStyle = (style) => __awaiter(this, void 0, void 0, function* () {
            validateResource({
                models: tradle.models,
                model: 'tradle.StylesPack',
                resource: style
            });
            const publicConf = yield this.publicConf.get();
            publicConf.style = style;
            yield this.savePublicConf(publicConf);
        });
        this.tradle = tradle;
        this.privateConfBucket = tradle.buckets.PrivateConf;
        this.publicConfBucket = tradle.buckets.PublicConf;
        this.privateConf = this.privateConfBucket.getCacheable({
            key: constants_1.PRIVATE_CONF_KEY,
            ttl: 60000,
            parse: JSON.parse.bind(JSON)
        });
        this.publicConf = this.publicConfBucket.getCacheable({
            key: constants_1.PUBLIC_CONF_KEY,
            ttl: 60000,
            parse: JSON.parse.bind(JSON)
        });
    }
}
exports.Conf = Conf;
function createConf({ tradle }) {
    return new Conf({ tradle });
}
exports.createConf = createConf;
//# sourceMappingURL=configure.js.map