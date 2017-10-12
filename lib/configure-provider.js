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
const _1 = require("./");
const { PUBLIC_CONF_BUCKET, TABLES_TO_PRECREATE } = _1.constants;
const KEY = PUBLIC_CONF_BUCKET.info;
function setStyle({ buckets, style }) {
    return __awaiter(this, void 0, void 0, function* () {
        debug('setting style', JSON.stringify(style, null, 2));
        validateResource({
            models: _1.models,
            model: 'tradle.StylesPack',
            resource: style
        });
        const info = yield buckets.PublicConf.getJSON(KEY);
        info.style = style;
        yield buckets.PublicConf.putJSON(KEY, info);
    });
}
exports.setStyle = setStyle;
function preCreateTables({ productsAPI, ids }) {
    return __awaiter(this, void 0, void 0, function* () {
        const { models, bot } = productsAPI;
        if (!Array.isArray(ids)) {
            const { products, productForCertificate } = models.biz;
            ids = products.map(product => {
                const cert = productForCertificate[product];
                return (models.all[product].forms || [])
                    .concat(cert ? cert.id : []);
            })
                .reduce((forms, batch) => forms.concat(batch), [])
                .concat(TABLES_TO_PRECREATE);
        }
        yield Promise.all(ids.map((id) => __awaiter(this, void 0, void 0, function* () {
            try {
                debug(`creating table ${id}`);
                yield bot.db.tables[id].create();
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