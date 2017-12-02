"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
        if (typeof name !== 'string') {
            throw new Error('expected string "name"');
        }
        this.name = name;
        this.id = name;
        this.utils = createS3Utils({ s3 });
        this.logger = logger || new logger_1.default(`bucket:${name}`);
        if (cache) {
            this.cache = cache;
            Object.assign(this, utils_1.cachify(this));
        }
    }
}
exports.Bucket = Bucket;
//# sourceMappingURL=bucket.js.map