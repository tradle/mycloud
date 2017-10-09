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
const debug = require('debug')('tradle:sls:config');
const validateResource = require("@tradle/validate-resource");
const _1 = require("../");
const { PUBLIC_CONF_BUCKET } = _1.constants;
const KEY = PUBLIC_CONF_BUCKET.info;
function setStyle(style) {
    return __awaiter(this, void 0, void 0, function* () {
        debug('setting style', JSON.stringify(style, null, 2));
        validateResource({
            models: _1.models,
            model: 'tradle.StylesPack',
            resource: style
        });
        const info = yield _1.buckets.PublicConf.getJSON(KEY);
        info.style = style;
        yield _1.buckets.PublicConf.putJSON(KEY, info);
    });
}
exports.setStyle = setStyle;
function preCreateTables({ db, ids }) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield Promise.all(ids.map((id) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield db.tables[id].create();
            }
            catch (err) {
                if (err.name !== 'ResourceInUseException') {
                    throw err;
                }
            }
        })));
    });
}
exports.preCreateTables = preCreateTables;
//# sourceMappingURL=configure-provider.js.map