"use strict";
const Cache = require("lru-cache");
const bucket_1 = require("./bucket");
const utils_1 = require("./utils");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MEG = 1024 * 1024;
const byteLengthFn = val => {
    if (utils_1.isPromise(val))
        return 10000;
    if (typeof val === 'string' || Buffer.isBuffer(val)) {
        return Buffer.byteLength(val);
    }
    return Buffer.byteLength(JSON.stringify(val));
};
const cacheConfig = {
    Objects: {
        length: byteLengthFn,
        max: 50 * MEG,
        maxAge: Infinity
    },
    Secrets: {
        max: 10,
        maxAge: HOUR
    },
    ContentAddressed: {
        length: byteLengthFn,
        max: 50 * MEG,
        maxAge: Infinity
    },
    PublicConf: {
        length: byteLengthFn,
        max: 50 * MEG,
        maxAge: MINUTE
    },
    PrivateConf: {
        length: byteLengthFn,
        max: 50 * MEG,
        maxAge: MINUTE
    },
    FileUpload: {
        length: byteLengthFn,
        max: 50 * MEG,
        maxAge: 10 * MINUTE
    }
};
module.exports = function getBuckets({ env, logger, aws, serviceMap }) {
    const { MEMORY_SIZE } = env;
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