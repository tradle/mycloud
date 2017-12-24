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
const lodash_1 = require("lodash");
const identity = a => a;
class CacheableBucketItem {
    constructor(opts) {
        this.getDatedValue = () => __awaiter(this, void 0, void 0, function* () {
            const value = yield this.get();
            return {
                value,
                lastModified: this.lastModified
            };
        });
        this.get = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { Body, LastModified } = yield this.value.get(opts);
            this.lastModified = new Date(LastModified).getTime();
            return this.parse(Body);
        });
        this.put = (value, opts = {}) => __awaiter(this, void 0, void 0, function* () {
            return yield this.value.put(Object.assign({ value }, opts));
        });
        this.value = opts.bucket.getCacheable(lodash_1.omit(opts, ['parse']));
        this.parse = opts.parse || identity;
        this.lastModified = null;
    }
}
exports.CacheableBucketItem = CacheableBucketItem;
//# sourceMappingURL=cacheable-bucket-item.js.map