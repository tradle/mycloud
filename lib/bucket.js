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
const path = require("path");
const _ = require("lodash");
const s3_utils_1 = require("./s3-utils");
const logger_1 = require("./logger");
const utils_1 = require("./utils");
const Errors = require("./errors");
class Bucket {
    constructor(opts) {
        this.folder = (prefix) => {
            return new Bucket(Object.assign({}, this.opts, { prefix: getFolderPath(this.prefix, prefix) }));
        };
        this.get = key => this.utils.get({
            key: this._getKey(key),
            bucket: this.name
        });
        this.getJSON = key => this.get(key).then(({ Body }) => JSON.parse(Body));
        this.list = () => this.utils.listBucket({ bucket: this.name });
        this.put = (key, value) => this.utils.put({
            key: this._getKey(key),
            value,
            bucket: this.name
        });
        this.putJSON = (key, value) => this.put(key, value);
        this.gzipAndPut = (key, value) => this.utils.gzipAndPut({
            key: this._getKey(key),
            value,
            bucket: this.name
        });
        this.head = key => this.utils.head({ key: this._getKey(key), bucket: this.name });
        this.exists = key => this.utils.exists({ key: this._getKey(key), bucket: this.name });
        this.del = key => this.utils.del({ key: this._getKey(key), bucket: this.name });
        this.getCacheable = opts => this.utils.getCacheable(Object.assign({}, opts, { key: this._getKey(opts.key), bucket: this.name }));
        this.create = () => this.utils.createBucket({ bucket: this.name });
        this.destroy = () => this.utils.destroyBucket({ bucket: this.name });
        this.clear = () => this.utils.clearBucket({ bucket: this.name });
        this.toString = () => this.name;
        this.urlForKey = (key) => this.utils.urlForKey({
            key: this._getKey(key),
            bucket: this.name
        });
        this.forEach = (opts) => this.utils.forEachItemInBucket(Object.assign({ bucket: this.name }, opts));
        this.enableEncryption = (opts = {}) => this.utils.enableEncryption(Object.assign({ bucket: this.name }, opts));
        this.disableEncryption = (opts = {}) => this.utils.disableEncryption(Object.assign({ bucket: this.name }, opts));
        this.getEncryption = (opts = {}) => this.utils.getEncryption(Object.assign({ bucket: this.name }, opts));
        this.putIfDifferent = (key, value) => __awaiter(this, void 0, void 0, function* () {
            key = this._getKey(key);
            let current;
            try {
                current = yield this.get(key);
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
            }
            if (!_.isEqual(current, value)) {
                this.put(key, value);
                return true;
            }
            return false;
        });
        this._getKey = key => this.prefix + key;
        const { name, env, s3, cache, logger, s3Utils, prefix = '' } = opts;
        this.opts = opts;
        if (typeof name !== 'string') {
            throw new Error('expected string "name"');
        }
        this.name = name;
        this.id = name;
        this.logger = logger || new logger_1.default(`bucket:${name}`);
        this.utils = s3Utils || s3_utils_1.default({ env, s3, logger: this.logger });
        this.prefix = prefix;
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
const getFolderPath = (parent, folder) => {
    const fPath = path.join(parent, folder);
    return fPath.replace(/[/]+$/, '') + '/';
};
//# sourceMappingURL=bucket.js.map