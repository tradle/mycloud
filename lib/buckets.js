"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Cache = require("lru-cache");
const bucket_1 = require("./bucket");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const cacheConfig = {
    Objects: {
        max: 500,
        maxAge: HOUR
    },
    Secrets: {
        max: 10,
        maxAge: MINUTE
    },
    ContentAddressed: {
        max: 500,
        maxAge: HOUR
    },
    PublicConf: {
        max: 10,
        maxAge: MINUTE
    },
    PrivateConf: {
        max: 10,
        maxAge: MINUTE
    },
    FileUpload: {
        max: 50,
        maxAge: 10 * MINUTE
    }
};
const CACHE_OPTS = {
    max: 500,
    maxAge: 60 * 1000 * 1000
};
module.exports = function getBuckets({ logger, aws, serviceMap }) {
    function loadBucket(name) {
        if (buckets[name])
            return;
        const physicalId = serviceMap.Bucket[name];
        if (!physicalId)
            throw new Error('bucket not found');
        buckets[name] = new bucket_1.Bucket({
            name: physicalId,
            s3: aws.s3,
            cache: cacheConfig[name] && new Cache(cacheConfig[name]),
            logger: logger.sub(`bucket:${name}`)
        });
    }
    const buckets = {};
    Object.keys(serviceMap.Bucket).forEach(loadBucket);
    return buckets;
};
//# sourceMappingURL=buckets.js.map