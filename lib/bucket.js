"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const createS3Utils = require("./s3-utils");
class Bucket {
    constructor({ name, s3 }) {
        this.get = key => this.utils.get({ key, bucket: this.name });
        this.getJSON = key => this.utils.getJSON({ key, bucket: this.name });
        this.put = (key, value) => this.utils.put({ key, value, bucket: this.name });
        this.putJSON = (key, value) => this.utils.putJSON({ key, value, bucket: this.name });
        this.head = key => this.utils.head({ key, bucket: this.name });
        this.exists = key => this.utils.exists({ key, bucket: this.name });
        this.del = key => this.utils.del({ key, bucket: this.name });
        this.getCacheable = opts => this.utils.getCacheable(Object.assign({}, opts, { bucket: this.name }));
        this.create = () => this.utils.createBucket({ bucket: this.name });
        this.toString = () => this.name;
        if (typeof name !== 'string') {
            throw new Error('expected string "name"');
        }
        this.name = name;
        this.id = name;
        this.s3 = s3;
        this.utils = createS3Utils({ s3 });
    }
}
exports.default = Bucket;
//# sourceMappingURL=bucket.js.map