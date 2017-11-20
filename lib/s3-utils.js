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
const parseUrl = require('url').parse;
const debug = require('debug')('tradle:sls:s3-utils');
const { logify, clone } = require('./utils');
const Errors = require('./errors');
module.exports = function createUtils(aws) {
    function put({ key, value, bucket, contentType }) {
        const opts = {
            Bucket: bucket,
            Key: key,
            Body: toStringOrBuf(value)
        };
        if (contentType) {
            opts.ContentType = contentType;
        }
        debugger;
        return aws.s3.putObject(opts).promise();
    }
    function get(_a) {
        var { key, bucket } = _a, opts = __rest(_a, ["key", "bucket"]);
        const params = Object.assign({ Bucket: bucket, Key: key }, opts);
        return aws.s3.getObject(params)
            .promise()
            .catch(err => {
            if (err.code === 'NoSuchKey') {
                throw new Errors.NotFound(`${bucket}/${key}`);
            }
            throw err;
        });
    }
    function getCacheable(_a) {
        var { key, bucket, ttl, parse } = _a, defaultOpts = __rest(_a, ["key", "bucket", "ttl", "parse"]);
        let cached;
        let etag;
        let cachedTime;
        const maybeGet = (opts) => __awaiter(this, void 0, void 0, function* () {
            if (etag && Date.now() - cachedTime < ttl) {
                return cached;
            }
            opts = Object.assign({}, defaultOpts, opts);
            if (etag) {
                opts.IfNoneMatch = etag;
            }
            cached = yield get(Object.assign({ key, bucket }, opts));
            if (cached.ETag !== etag) {
                etag = cached.ETag;
            }
            if (parse) {
                cached = parse(cached.Body);
            }
            cachedTime = Date.now();
            return cached;
        });
        const putAndCache = (_b) => __awaiter(this, void 0, void 0, function* () {
            var { value } = _b, opts = __rest(_b, ["value"]);
            const result = yield put(Object.assign({ bucket, key, value }, defaultOpts, opts));
            cached = parse ? value : result;
            cachedTime = Date.now();
            etag = result.ETag;
        });
        return {
            get: maybeGet,
            put: putAndCache
        };
    }
    const putJSON = put;
    function getJSON({ key, bucket }) {
        return get({ key, bucket })
            .then(({ Body }) => JSON.parse(Body));
    }
    function head({ key, bucket }) {
        return aws.s3.headObject({
            Bucket: bucket,
            Key: key
        }).promise();
    }
    function exists({ key, bucket }) {
        return head({ key, bucket })
            .then(() => true, err => false);
    }
    function del({ key, bucket }) {
        return aws.s3.deleteObject({
            Bucket: bucket,
            Key: key
        }).promise();
    }
    function createPresignedUrl({ bucket, key }) {
        return aws.s3.getSignedUrl('getObject', {
            Bucket: bucket,
            Key: key
        });
    }
    function createBucket({ bucket }) {
        return aws.s3.createBucket({ Bucket: bucket }).promise();
    }
    return {
        createBucket,
        get,
        getJSON,
        getCacheable,
        put,
        putJSON,
        head,
        del,
        exists,
        createPresignedUrl
    };
};
const toStringOrBuf = (value) => {
    if (typeof value === 'string')
        return value;
    if (Buffer.isBuffer(value))
        return value;
    return JSON.stringify(value);
};
//# sourceMappingURL=s3-utils.js.map