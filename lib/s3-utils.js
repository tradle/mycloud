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
const Errors = require("./errors");
const logger_1 = require("./logger");
module.exports = function createUtils(aws) {
    const logger = new logger_1.default('s3-utils');
    const put = ({ key, value, bucket, contentType }) => __awaiter(this, void 0, void 0, function* () {
        const opts = {
            Bucket: bucket,
            Key: key,
            Body: toStringOrBuf(value)
        };
        if (contentType) {
            opts.ContentType = contentType;
        }
        return yield aws.s3.putObject(opts).promise();
    });
    const get = (_a) => __awaiter(this, void 0, void 0, function* () {
        var { key, bucket } = _a, opts = __rest(_a, ["key", "bucket"]);
        const params = Object.assign({ Bucket: bucket, Key: key }, opts);
        try {
            return yield aws.s3.getObject(params).promise();
        }
        catch (err) {
            if (err.code === 'NoSuchKey') {
                throw new Errors.NotFound(`${bucket}/${key}`);
            }
            throw err;
        }
    });
    const listBucket = (_b) => __awaiter(this, void 0, void 0, function* () {
        var { bucket } = _b, opts = __rest(_b, ["bucket"]);
        const params = Object.assign({ Bucket: bucket }, opts);
        return yield aws.s3.listObjects(params).promise();
    });
    const clearBucket = ({ bucket }) => __awaiter(this, void 0, void 0, function* () {
        const { Contents } = yield listBucket({ bucket });
        yield Promise.all(Contents.map(({ Key }) => del({ bucket, key: Key })));
    });
    const getCacheable = (_a) => {
        var { key, bucket, ttl, parse } = _a, defaultOpts = __rest(_a, ["key", "bucket", "ttl", "parse"]);
        let cached;
        let etag;
        let cachedTime;
        const maybeGet = (opts) => __awaiter(this, void 0, void 0, function* () {
            if (typeof opts === 'string') {
                opts = { key: opts };
            }
            const age = Date.now() - cachedTime;
            if (etag && age < ttl) {
                logger.debug(`returning cached item for key ${key}, ttl: ${(ttl - age)}`);
                return cached;
            }
            opts = Object.assign({}, defaultOpts, opts);
            if (etag) {
                opts.IfNoneMatch = etag;
            }
            try {
                cached = yield get(Object.assign({ key, bucket }, opts));
            }
            catch (err) {
                if (err.code === 'NotModified') {
                    logger.debug(`304, returning cached item for key ${key}, ETag ${etag}`);
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
            logger.debug(`fetched and cached item for key ${key}, ETag ${etag}`);
            return cached;
        });
        const putAndCache = (_b) => __awaiter(this, void 0, void 0, function* () {
            var { value } = _b, opts = __rest(_b, ["value"]);
            if (value == null)
                throw new Error('expected "value"');
            const result = yield put(Object.assign({ bucket, key, value }, defaultOpts, opts));
            cached = parse ? value : result;
            cachedTime = Date.now();
            etag = result.ETag;
        });
        return {
            get: maybeGet,
            put: putAndCache
        };
    };
    const putJSON = put;
    const getJSON = ({ key, bucket }) => {
        return get({ key, bucket }).then(({ Body }) => JSON.parse(Body));
    };
    const head = ({ key, bucket }) => {
        return aws.s3.headObject({
            Bucket: bucket,
            Key: key
        }).promise();
    };
    const exists = ({ key, bucket }) => {
        return head({ key, bucket })
            .then(() => true, err => false);
    };
    const del = ({ key, bucket }) => {
        return aws.s3.deleteObject({
            Bucket: bucket,
            Key: key
        }).promise();
    };
    const createPresignedUrl = ({ bucket, key }) => {
        return aws.s3.getSignedUrl('getObject', {
            Bucket: bucket,
            Key: key
        });
    };
    const createBucket = ({ bucket }) => {
        return aws.s3.createBucket({ Bucket: bucket }).promise();
    };
    const destroyBucket = ({ bucket }) => {
        return aws.s3.deleteBucket({ Bucket: bucket }).promise();
    };
    const urlForKey = ({ bucket, key }) => {
        const { host } = aws.s3.endpoint;
        if (host.startsWith('localhost')) {
            return `http://${host}/${bucket}${key}`;
        }
        return `https://${bucket}.s3.amazonaws.com/${key}`;
    };
    return {
        get,
        getJSON,
        getCacheable,
        listBucket,
        clearBucket,
        put,
        putJSON,
        head,
        del,
        exists,
        createPresignedUrl,
        createBucket,
        destroyBucket,
        urlForKey
    };
};
const toStringOrBuf = (value) => {
    if (typeof value === 'string')
        return value;
    if (Buffer.isBuffer(value))
        return value;
    if (!value)
        throw new Error('expected string, Buffer, or stringifiable object');
    return JSON.stringify(value);
};
//# sourceMappingURL=s3-utils.js.map