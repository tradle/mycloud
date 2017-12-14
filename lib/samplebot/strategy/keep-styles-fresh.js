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
const crypto = require("crypto");
const stableStringify = require("json-stable-stringify");
const defaultPropertyName = 'stylesHash';
function defaultGetIdentifier(req) {
    return req.user.id;
}
function hashObject(obj) {
    return hashString('sha256', stableStringify(obj));
}
function hashString(algorithm, data) {
    return crypto.createHash(algorithm).update(data).digest('hex');
}
exports.keepStylesFreshPlugin = ({ styles, propertyName = defaultPropertyName, getIdentifier = defaultGetIdentifier, send }) => {
    const hash = hashObject(styles);
    return (req) => __awaiter(this, void 0, void 0, function* () {
        const identifier = getIdentifier(req);
        const { user } = req;
        if (!user[propertyName]) {
            user[propertyName] = {};
        }
        const container = user[propertyName];
        const stylesHash = container[identifier];
        if (hash === stylesHash)
            return;
        container[identifier] = hash;
        yield send({ req, object: styles });
    });
};
//# sourceMappingURL=keep-styles-fresh.js.map