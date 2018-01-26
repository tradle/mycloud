"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) if (e.indexOf(p[i]) < 0)
            t[p[i]] = s[p[i]];
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const Errors = require("./errors");
const utils_1 = require("./utils");
function createUtils({ s3, logger, env }) {
    let utils;
    const put = ({ key, value, bucket, headers = {} }) => __awaiter(this, void 0, void 0, function* () {
        const opts = Object.assign({}, headers, { Bucket: bucket, Key: key, Body: toStringOrBuf(value) });
        return yield s3.putObject(opts).promise();
    });
    const gzipAndPut = (opts) => __awaiter(this, void 0, void 0, function* () {
        const { value, headers = {} } = opts;
        const compressed = yield utils_1.gzip(toStringOrBuf(value));
        return yield utils.put(Object.assign({}, opts, { value: compressed, headers: Object.assign({}, headers, { ContentEncoding: 'gzip' }) }));
    });
    const get = (_a) => __awaiter(this, void 0, void 0, function* () {
        var { key, bucket } = _a, opts = __rest(_a, ["key", "bucket"]);
        const params = Object.assign({ Bucket: bucket, Key: key }, opts);
        try {
            const result = yield s3.getObject(params).promise();
            if (result.ContentEncoding === 'gzip') {
                if (!(env && env.TESTING)) {
                    result.Body = yield utils_1.gunzip(result.Body);
                    delete result.ContentEncoding;
                }
            }
            return result;
        }
        catch (err) {
            if (err.code === 'NoSuchKey') {
                throw new Errors.NotFound(`${bucket}/${key}`);
            }
            throw err;
        }
    });
    const forEachItemInBucket = (_b) => __awaiter(this, void 0, void 0, function* () {
        var { bucket, getBody, map } = _b, opts = __rest(_b, ["bucket", "getBody", "map"]);
        const params = Object.assign({ Bucket: bucket }, opts);
        let Marker;
        while (true) {
            let { NextMarker, Contents } = yield s3.listObjects(params).promise();
            if (getBody) {
                yield utils_1.batchProcess({
                    data: Contents,
                    batchSize: 20,
                    processOne: (item) => __awaiter(this, void 0, void 0, function* () {
                        const withBody = yield s3.getObject({ Bucket: bucket, Key: item.Key }).promise();
                        let result = map(Object.assign({}, item, withBody));
                        if (utils_1.isPromise(result))
                            yield result;
                    })
                });
            }
            else {
                yield Promise.all(Contents.map((item) => __awaiter(this, void 0, void 0, function* () {
                    const result = map(item);
                    if (utils_1.isPromise(result))
                        yield result;
                })));
            }
            if (!NextMarker)
                break;
            params.Marker = NextMarker;
        }
    });
    const listBucket = (_c) => __awaiter(this, void 0, void 0, function* () {
        var { bucket } = _c, opts = __rest(_c, ["bucket"]);
        const all = [];
        yield forEachItemInBucket(Object.assign({}, opts, { bucket, map: item => all.push(item) }));
        return all;
    });
    const clearBucket = ({ bucket }) => __awaiter(this, void 0, void 0, function* () {
        yield forEachItemInBucket({
            bucket,
            map: ({ Key }) => del({ bucket, key: Key })
        });
    });
    const getCacheable = (_a) => {
        var { key, bucket, ttl, parse } = _a, defaultOpts = __rest(_a, ["key", "bucket", "ttl", "parse"]);
        if (!key)
            throw new Error('expected "key"');
        if (!bucket)
            throw new Error('expected "bucket"');
        if (!ttl)
            throw new Error('expected "ttl"');
        let cached;
        let type;
        let etag;
        let cachedTime = 0;
        const invalidateCache = () => {
            cached = undefined;
            type = undefined;
            etag = undefined;
            cachedTime = 0;
        };
        const maybeGet = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            let summary = { key, bucket, type };
            if (!opts.force) {
                const age = Date.now() - cachedTime;
                if (etag && age < ttl) {
                    logger.debug('returning cached item', Object.assign({}, summary, { age, ttl: (ttl - age) }));
                    return cached;
                }
            }
            opts = Object.assign({}, defaultOpts, _.omit(opts, ['force']));
            if (etag) {
                opts.IfNoneMatch = etag;
            }
            try {
                cached = yield utils.get(Object.assign({ key, bucket }, opts));
            }
            catch (err) {
                if (err.code === 'NotModified') {
                    logger.debug('304, returning cached item', summary);
                    return cached;
                }
                throw err;
            }
            if (cached.ETag !== etag) {
                etag = cached.ETag;
            }
            if (parse) {
                cached = parse(cached.Body);
            }
            cachedTime = Date.now();
            logger.debug('fetched and cached item', summary);
            return cached;
        });
        const putAndCache = (_b) => __awaiter(this, void 0, void 0, function* () {
            var { value } = _b, opts = __rest(_b, ["value"]);
            if (value == null)
                throw new Error('expected "value"');
            const result = yield utils.put(Object.assign({ bucket, key, value }, defaultOpts, opts));
            cached = parse ? value : result;
            cachedTime = Date.now();
            etag = result.ETag;
        });
        return {
            get: maybeGet,
            put: putAndCache,
            invalidateCache
        };
    };
    const putJSON = put;
    const getJSON = ({ key, bucket }) => {
        return utils.get({ key, bucket }).then(({ Body }) => JSON.parse(Body));
    };
    const head = ({ key, bucket }) => __awaiter(this, void 0, void 0, function* () {
        try {
            yield s3.headObject({
                Bucket: bucket,
                Key: key
            }).promise();
        }
        catch (err) {
            if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
                throw new Errors.NotFound(`${bucket}/${key}`);
            }
        }
    });
    const exists = ({ key, bucket }) => {
        return head({ key, bucket })
            .then(() => true, err => false);
    };
    const del = ({ key, bucket }) => {
        return s3.deleteObject({
            Bucket: bucket,
            Key: key
        }).promise();
    };
    const createPresignedUrl = ({ bucket, key }) => {
        return s3.getSignedUrl('getObject', {
            Bucket: bucket,
            Key: key
        });
    };
    const createBucket = ({ bucket }) => {
        return s3.createBucket({ Bucket: bucket }).promise();
    };
    const destroyBucket = ({ bucket }) => {
        return s3.deleteBucket({ Bucket: bucket }).promise();
    };
    const urlForKey = ({ bucket, key }) => {
        const { host } = s3.endpoint;
        if (host.startsWith('localhost')) {
            return `http://${host}/${bucket}${key}`;
        }
        return `https://${bucket}.s3.amazonaws.com/${key}`;
    };
    const disableEncryption = ({ bucket }) => __awaiter(this, void 0, void 0, function* () {
        logger.info(`disabling server-side encryption from bucket ${bucket}`);
        yield s3.deleteBucketEncryption({ Bucket: bucket }).promise();
    });
    const enableEncryption = ({ bucket, kmsKeyId }) => __awaiter(this, void 0, void 0, function* () {
        logger.info(`enabling server-side encryption for bucket ${bucket}`);
        const params = toEncryptionParams({ bucket, kmsKeyId });
        yield s3.putBucketEncryption(params).promise();
    });
    const getEncryption = ({ bucket }) => __awaiter(this, void 0, void 0, function* () {
        return yield s3.getBucketEncryption({ Bucket: bucket }).promise();
    });
    return utils = utils_1.timeMethods({
        get,
        getJSON,
        getCacheable,
        listBucket,
        clearBucket,
        put,
        putJSON,
        gzipAndPut,
        head,
        del,
        exists,
        createPresignedUrl,
        createBucket,
        destroyBucket,
        urlForKey,
        forEachItemInBucket,
        enableEncryption,
        disableEncryption,
        getEncryption
    }, logger);
}
exports.default = createUtils;
exports.createUtils = createUtils;
const toStringOrBuf = (value) => {
    if (typeof value === 'string')
        return value;
    if (Buffer.isBuffer(value))
        return value;
    if (!value)
        throw new Error('expected string, Buffer, or stringifiable object');
    return JSON.stringify(value);
};
const toEncryptionParams = ({ bucket, kmsKeyId }) => {
    const ApplyServerSideEncryptionByDefault = {
        SSEAlgorithm: kmsKeyId ? 'aws:kms' : 'AES256'
    };
    if (kmsKeyId) {
        ApplyServerSideEncryptionByDefault.KMSMasterKeyID = kmsKeyId;
    }
    return {
        Bucket: bucket,
        ServerSideEncryptionConfiguration: {
            Rules: [
                {
                    ApplyServerSideEncryptionByDefault
                }
            ]
        }
    };
};
//# sourceMappingURL=s3-utils.js.map