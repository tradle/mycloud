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
class KeyValueTable {
    constructor({ table, prefix = '' }) {
        this.exists = (key) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.get(key, {
                    AttributesToGet: ['key']
                });
                return true;
            }
            catch (err) {
                return false;
            }
        });
        this.get = (key, opts = {}) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { value } = yield this.table.get(Object.assign({ Key: this.wrapKey(key) }, opts));
                return value;
            }
            catch (err) {
                if (err.code === 'ResourceNotFoundException' || err.name === 'NotFound') {
                    err.name = 'NotFound';
                    err.notFound = true;
                }
                throw err;
            }
        });
        this.put = (key, value) => __awaiter(this, void 0, void 0, function* () {
            yield this.table.put({
                Item: {
                    key: this.getKey(key),
                    value
                }
            });
        });
        this.del = (key) => __awaiter(this, void 0, void 0, function* () {
            yield this.table.del({
                Key: this.wrapKey(key)
            });
        });
        this.update = (key, opts) => __awaiter(this, void 0, void 0, function* () {
            const result = yield this.table.update(Object.assign({ Key: this.wrapKey(key) }, opts));
            return result && result.value;
        });
        this.sub = (prefix = '') => {
            return new KeyValueTable({
                table: this.table,
                prefix: this.prefix + prefix
            });
        };
        this.getKey = (key) => {
            return this.prefix + key;
        };
        this.wrapKey = (key) => {
            return {
                key: this.prefix + key
            };
        };
        this.table = table;
        this.prefix = prefix;
    }
}
exports.default = KeyValueTable;
exports.KeyValueTable = KeyValueTable;
//# sourceMappingURL=key-value-table.js.map