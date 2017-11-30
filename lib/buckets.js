"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Cache = require("lru-cache");
const bucket_1 = require("./bucket");
const utils_1 = require("./utils");
const cachifiable = {
    Objects: true,
    ContentAddressed: true
};
const CACHE_OPTS = {
    max: 200,
    maxAge: 60 * 1000
};
module.exports = function getBuckets({ aws, serviceMap }) {
    function loadBucket(name) {
        if (buckets[name])
            return;
        const physicalId = serviceMap.Bucket[name];
        if (!physicalId)
            throw new Error('bucket not found');
        const bucket = new bucket_1.Bucket({ name: physicalId, s3: aws.s3 });
        if (cachifiable[name]) {
            const cachified = utils_1.cachify({
                get: bucket.getJSON,
                put: bucket.putJSON,
                cache: new Cache(CACHE_OPTS)
            });
            bucket.getJSON = cachified.get;
            bucket.putJSON = cachified.put;
        }
        buckets[name] = bucket;
    }
    const buckets = {};
    Object.keys(serviceMap.Bucket).forEach(loadBucket);
    return buckets;
};
//# sourceMappingURL=buckets.js.map