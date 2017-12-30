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
const createS3Utils = require("./s3-utils");
const logger_1 = require("./logger");
const utils_1 = require("./utils");
class Bucket {
    constructor({ name, s3, cache, logger }) {
        this.get = key => this.utils.get({ key, bucket: this.name });
        this.getJSON = key => this.get(key).then(({ Body }) => JSON.parse(Body));
        this.list = () => this.utils.listBucket({ bucket: this.name });
        this.put = (key, value) => this.utils.put({ key, value, bucket: this.name });
        this.putJSON = (key, value) => this.put(key, value);
        this.head = key => this.utils.head({ key, bucket: this.name });
        this.exists = key => this.utils.exists({ key, bucket: this.name });
        this.del = key => this.utils.del({ key, bucket: this.name });
        this.getCacheable = opts => this.utils.getCacheable(Object.assign({}, opts, { bucket: this.name }));
        this.create = () => this.utils.createBucket({ bucket: this.name });
        this.destroy = () => this.utils.destroyBucket({ bucket: this.name });
        this.clear = () => this.utils.clearBucket({ bucket: this.name });
        this.toString = () => this.name;
        this.urlForKey = (key) => this.utils.urlForKey({ key, bucket: this.name });
        this.forEach = (opts) => this.utils.forEachItemInBucket(Object.assign({ bucket: this.name }, opts));
        this.putIfDifferent = (key, value) => __awaiter(this, void 0, void 0, function* () {
            const current = yield this.get(key);
            if (!lodash_1.default.isEqual(current, value)) {
                this.put(key, value);
                return true;
            }
            return false;
        });
        if (typeof name !== 'string') {
            throw new Error('expected string "name"');
        }
        this.name = name;
        this.id = name;
        this.logger = logger || new logger_1.default(`bucket:${name}`);
        this.utils = createS3Utils({ s3, logger: this.logger });
        if (cache) {
            this.cache = cache;
            const cachified = utils_1.cachify({
                get: this.getJSON,
                put: this.put,
                del: this.del,
                logger: this.logger,
                cache
            });
            this.getJSON = cachified.get;
            this.putJSON = cachified.put;
            this.del = cachified.del;
        }
    }
}
exports.Bucket = Bucket;
//# sourceMappingURL=bucket.js.map