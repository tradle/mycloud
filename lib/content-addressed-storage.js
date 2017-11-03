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
const promisify = require("pify");
const collect = require("stream-collector");
const crypto_1 = require("./crypto");
const string_utils_1 = require("./string-utils");
const promiseCollect = promisify(collect);
const defaultHasher = data => crypto_1.sha256(data, 'hex');
class ContentAddressedStorage {
    constructor({ aws, bucket, hasher = defaultHasher }) {
        this.get = key => this.bucket.get(key);
        this.put = (data) => __awaiter(this, void 0, void 0, function* () {
            const key = this.hasher(serialize(data));
            yield this.bucket.put(key, data);
            return key;
        });
        this.bucket = bucket;
        this.aws = aws;
        this.hasher = hasher;
    }
}
exports.default = ContentAddressedStorage;
const serialize = data => {
    if (typeof data === 'string' || Buffer.isBuffer(data)) {
        return data;
    }
    return string_utils_1.stableStringify(data);
};
//# sourceMappingURL=content-addressed-storage.js.map