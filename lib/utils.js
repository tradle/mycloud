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
const Promise = require("bluebird");
const querystring = require("querystring");
const format = require("string-format");
exports.format = format;
const microtime = require("./microtime");
const typeforce = require("typeforce");
exports.typeforce = typeforce;
const bindAll = require("bindall");
exports.bindAll = bindAll;
const omit = require("object.omit");
exports.omit = omit;
const pick = require("object.pick");
exports.pick = pick;
const deepEqual = require("deep-equal");
exports.deepEqual = deepEqual;
const deepClone = require("clone");
exports.deepClone = deepClone;
const clone = require("xtend");
exports.clone = clone;
const extend = require("xtend/mutable");
exports.extend = extend;
const flatten = require("flatten");
exports.flatten = flatten;
const traverse = require("traverse");
exports.traverse = traverse;
const dotProp = require("dot-prop");
exports.dotProp = dotProp;
const uuid_1 = require("uuid");
exports.uuid = uuid_1.v4;
const co_1 = require("co");
exports.co = co_1.wrap;
const promisify = require("pify");
exports.promisify = promisify;
const settle_promise_1 = require("settle-promise");
exports.allSettled = settle_promise_1.settle;
const isGenerator = require("is-generator-function");
exports.isGenerator = isGenerator;
const strong_data_uri_1 = require("strong-data-uri");
exports.encodeDataURI = strong_data_uri_1.encode;
exports.decodeDataURI = strong_data_uri_1.decode;
const dynamodb_marshaler_1 = require("dynamodb-marshaler");
const buildResource = require("@tradle/build-resource");
const fetch = require("node-fetch");
exports.fetch = fetch;
const string_utils_1 = require("./string-utils");
const constants_1 = require("./constants");
const errors_1 = require("./errors");
const debug = require('debug')('tradle:sls:utils');
const notNull = obj => obj != null;
const isPromise = obj => obj && typeof obj.then === 'function';
exports.isPromise = isPromise;
const { omitVirtual, setVirtual, pickVirtual } = buildResource;
exports.omitVirtual = omitVirtual;
exports.setVirtual = setVirtual;
exports.pickVirtual = pickVirtual;
const LAUNCH_STACK_BASE_URL = 'https://console.aws.amazon.com/cloudformation/home';
const { MESSAGE } = constants_1.TYPES;
const noop = () => { };
exports.noop = noop;
const unrefdTimeout = (...args) => {
    const handle = setTimeout(...args);
    if (handle.unref)
        handle.unref();
    return handle;
};
const createTimeout = (fn, millis, unref) => {
    const timeout = setTimeout(fn, millis);
    if (unref && timeout.unref)
        timeout.unref();
    return timeout;
};
exports.waitImmediate = () => {
    return new Promise(resolve => setImmediate(resolve));
};
exports.wait = (millis = 0, unref) => {
    return new Promise(resolve => {
        createTimeout(resolve, millis, unref);
    });
};
exports.timeoutIn = (millis = 0, unref) => {
    let timeout;
    const { stack } = new Error();
    const promise = new Promise((resolve, reject) => {
        timeout = createTimeout(() => {
            reject(new Error('timed out'));
        }, millis, unref);
    });
    promise.cancel = () => clearTimeout(timeout);
    return promise;
};
function loudCo(gen) {
    return co_1.wrap(function* (...args) {
        try {
            return yield co_1.wrap(gen).apply(this, args);
        }
        catch (err) {
            console.error(err);
            throw err;
        }
    });
}
exports.loudCo = loudCo;
function loudAsync(asyncFn) {
    return (...args) => __awaiter(this, void 0, void 0, function* () {
        try {
            return yield asyncFn(...args);
        }
        catch (err) {
            console.error(err);
            throw err;
        }
    });
}
exports.loudAsync = loudAsync;
function toBuffer(data) {
    if (typeof data === 'string')
        return new Buffer(data);
    if (Buffer.isBuffer(data))
        return data;
    return new Buffer(string_utils_1.stableStringify(data));
}
exports.toBuffer = toBuffer;
function now() {
    return Date.now();
}
exports.now = now;
function groupBy(items, prop) {
    const groups = {};
    for (const item of items) {
        const val = item[prop];
        if (!groups[val]) {
            groups[val] = [];
        }
        groups[val].push(item);
    }
    return groups;
}
exports.groupBy = groupBy;
function cachifyPromiser(fn) {
    let promise;
    return function (...args) {
        if (!promise)
            promise = fn.apply(this, args);
        return promise;
    };
}
exports.cachifyPromiser = cachifyPromiser;
function firstSuccess(promises) {
    return Promise.all(promises.map(p => {
        return p.then(val => {
            const wrapper = new Error('wrapper for success');
            wrapper.firstSuccessResult = val;
            return Promise.reject(wrapper);
        }, err => Promise.resolve(err));
    })).then(errors => {
        const wrapper = new Error('wrapper for errors');
        wrapper.errors = errors;
        return Promise.reject(wrapper);
    }, val => Promise.resolve(val.firstSuccessResult));
}
exports.firstSuccess = firstSuccess;
function uppercaseFirst(str) {
    return str[0].toUpperCase() + str.slice(1);
}
exports.uppercaseFirst = uppercaseFirst;
function logifyFunction({ fn, name, log = debug, logInputOutput = false }) {
    return co_1.wrap(function* (...args) {
        const taskName = typeof name === 'function'
            ? name.apply(this, args)
            : name;
        let start = Date.now();
        let duration;
        let ret;
        let err;
        try {
            ret = yield fn.apply(this, args);
        }
        catch (e) {
            err = e;
            throw err;
        }
        finally {
            duration = Date.now() - start;
            const parts = [
                taskName,
                err ? 'failed' : 'succeeded',
                `in ${duration}ms`
            ];
            if (logInputOutput) {
                parts.push('input:', string_utils_1.prettify(args));
                if (!err) {
                    parts.push('output:', string_utils_1.prettify(ret));
                }
            }
            if (err) {
                parts.push(err.stack);
            }
            log(parts.join(' '));
        }
        return ret;
    });
}
exports.logifyFunction = logifyFunction;
function logify(obj, opts = {}) {
    const { log = debug, logInputOutput } = opts;
    const logified = {};
    for (let p in obj) {
        let val = obj[p];
        if (typeof val === 'function') {
            logified[p] = logifyFunction({
                fn: val,
                name: p,
                log,
                logInputOutput
            });
        }
        else {
            logified[p] = val;
        }
    }
    return logified;
}
exports.logify = logify;
function cachify({ get, put, del, logger, cache }) {
    const pending = {};
    const cachifiedGet = co_1.wrap(function* (key) {
        const keyStr = string_utils_1.stableStringify(key);
        let val = cache.get(keyStr);
        if (val != null) {
            if (logger)
                logger.debug(`cache hit on ${key}!`);
            if (isPromise(val)) {
                return val.catch(err => cachifiedGet(key));
            }
            return val;
        }
        if (logger)
            logger.debug(`cache miss on ${key}`);
        const promise = get(key);
        promise.catch(err => cache.del(keyStr));
        cache.set(keyStr, promise);
        return promise;
    });
    return {
        get: cachifiedGet,
        put: co_1.wrap(function* (key, value) {
            if (logger)
                logger.debug(`cache: set ${key}`);
            const keyStr = string_utils_1.stableStringify(key);
            if (logger && cache.has(keyStr)) {
                logger.warn(`cache already has value for ${key}, put may not be necessary`);
            }
            cache.del(keyStr);
            const ret = yield put(key, value);
            cache.set(keyStr, value);
            return ret;
        }),
        del: co_1.wrap(function* (key) {
            const keyStr = string_utils_1.stableStringify(key);
            if (logger)
                logger.debug(`cache unset ${key}`);
            cache.del(keyStr);
            return yield del(key);
        })
    };
}
exports.cachify = cachify;
function timestamp() {
    return microtime.now();
}
exports.timestamp = timestamp;
function executeSuperagentRequest(req) {
    return req.then(res => {
        if (!res.ok) {
            throw new Error(res.text || `request to ${req.url} failed`);
        }
    });
}
exports.executeSuperagentRequest = executeSuperagentRequest;
function promiseCall(fn, ...args) {
    return new Promise((resolve, reject) => {
        args.push(function (err, result) {
            if (err)
                return reject(err);
            resolve(result);
        });
        fn.apply(this, args);
    });
}
exports.promiseCall = promiseCall;
function series(fns, ...args) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = [];
        for (const fn of fns) {
            let result = fn.apply(this, args);
            if (isPromise(result)) {
                result = yield result;
            }
            results.push(result);
        }
        return results;
    });
}
exports.series = series;
function seriesWithExit(fns, ...args) {
    return __awaiter(this, void 0, void 0, function* () {
        for (let fn of fns) {
            let keepGoing = fn.apply(this, args);
            if (isPromise(keepGoing)) {
                yield keepGoing;
            }
            if (keepGoing === false)
                return;
        }
    });
}
exports.seriesWithExit = seriesWithExit;
function waterfall(fns, ...args) {
    return __awaiter(this, void 0, void 0, function* () {
        let result;
        for (let fn of fns) {
            result = fn.apply(this, args);
            if (isPromise(result)) {
                result = yield result;
            }
            args = [result];
        }
        return result;
    });
}
exports.waterfall = waterfall;
function launchStackUrl({ region = process.env.AWS_REGION, stackName, templateURL }) {
    const qs = querystring.stringify({ stackName, templateURL });
    return `${LAUNCH_STACK_BASE_URL}?region=${region}#/stacks/new?${qs}`;
}
exports.launchStackUrl = launchStackUrl;
function domainToUrl(domain) {
    if (domain.startsWith('//')) {
        return 'http:' + domain;
    }
    if (!/^https?:\/\//.test(domain)) {
        return 'http://' + domain;
    }
    return domain;
}
exports.domainToUrl = domainToUrl;
exports.batchProcess = ({ data, batchSize = 1, processOne, processBatch, series, settle }) => __awaiter(this, void 0, void 0, function* () {
    const batches = batchify(data, batchSize);
    let batchResolver;
    if (series) {
        if (!processOne) {
            throw new Error('expected "processOne"');
        }
        batchResolver = settle ? exports.settleSeries : Promise.mapSeries;
    }
    else {
        batchResolver = settle ? exports.settleMap : Promise.map;
    }
    const results = yield Promise.mapSeries(batches, batch => {
        if (processBatch) {
            return processBatch(batch);
        }
        return batchResolver(batch, one => processOne(one));
    });
    return flatten(results);
});
exports.settleMap = (data, fn) => {
    return exports.RESOLVED_PROMISE.then(() => settle_promise_1.settle(data.map(item => fn(item))));
};
exports.settleSeries = (data, fn) => {
    return Promise.mapSeries(data, (item) => __awaiter(this, void 0, void 0, function* () {
        const results = yield settle_promise_1.settle(exports.RESOLVED_PROMISE.then(() => fn(item)));
        return results[0];
    }));
};
function batchify(arr, batchSize) {
    const batches = [];
    while (arr.length) {
        batches.push(arr.slice(0, batchSize));
        arr = arr.slice(batchSize);
    }
    return batches;
}
exports.batchify = batchify;
function runWithBackoffWhile(fn, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const { initialDelay = 1000, maxAttempts = 10, maxTime = 60000, factor = 2, shouldTryAgain } = opts;
        const { maxDelay = maxTime / 2 } = opts;
        const start = Date.now();
        let millisToWait = initialDelay;
        let attempts = 0;
        while (Date.now() - start < maxTime && attempts++ < maxAttempts) {
            try {
                return yield fn();
            }
            catch (err) {
                if (!shouldTryAgain(err)) {
                    throw err;
                }
                yield exports.wait(millisToWait);
                millisToWait = Math.min(maxDelay, millisToWait * factor, maxTime - Date.now());
            }
        }
        throw new Error('timed out');
    });
}
exports.runWithBackoffWhile = runWithBackoffWhile;
const GIVE_UP_TIME = 2000;
const GIVE_UP_RETRY_TIME = 5000;
function tryUntilTimeRunsOut(fn, opts = {}) {
    return __awaiter(this, void 0, void 0, function* () {
        const { attemptTimeout, onError = noop, env } = opts;
        let err;
        while (true) {
            let timeLeft = env.getRemainingTime();
            let timeout = Math.min(attemptTimeout, timeLeft / 2);
            try {
                return yield Promise.race([
                    Promise.resolve(fn()),
                    exports.timeoutIn(timeout, true)
                ]);
            }
            catch (e) {
                err = e;
            }
            onError(err);
            timeLeft = env.getRemainingTime();
            if (timeLeft < GIVE_UP_RETRY_TIME) {
                if (err)
                    throw err;
                if (timeLeft < GIVE_UP_TIME) {
                    throw new errors_1.ExecutionTimeout(`aborting with ${timeLeft}ms execution time left`);
                }
            }
            yield exports.wait(Math.min(2000, timeLeft / 2));
        }
    });
}
exports.tryUntilTimeRunsOut = tryUntilTimeRunsOut;
function seriesMap(arr, fn) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = [];
        for (const item of arr) {
            const result = yield fn(item);
            results.push(result);
        }
        return results;
    });
}
exports.seriesMap = seriesMap;
function get(url, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        debug(`GET ${url}`);
        const res = yield fetch(url, opts);
        return processResponse(res);
    });
}
exports.get = get;
function post(url, data) {
    return __awaiter(this, void 0, void 0, function* () {
        debug(`POST to ${url}`);
        const res = yield fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        debug(`processing response from POST to ${url}`);
        return processResponse(res);
    });
}
exports.post = post;
function download({ url }) {
    return __awaiter(this, void 0, void 0, function* () {
        debug(`downloading from ${url}`);
        const res = yield fetch(url);
        if (res.status > 300) {
            throw new Error(res.statusText);
        }
        const buf = yield res.buffer();
        buf.mimetype = res.headers.get('content-type');
        return buf;
    });
}
exports.download = download;
function processResponse(res) {
    return __awaiter(this, void 0, void 0, function* () {
        if (res.status > 300) {
            let message = res.statusText;
            if (!message) {
                message = yield res.text();
            }
            const err = new Error(message);
            err.code = res.status;
            throw err;
        }
        const text = yield res.text();
        const contentType = res.headers.get('content-type') || '';
        if (contentType.startsWith('application/json')) {
            return JSON.parse(text);
        }
        return text;
    });
}
function batchStringsBySize(strings, max) {
    strings = strings.filter(s => s.length);
    const batches = [];
    let cur = [];
    let str;
    let length = 0;
    while (str = strings.shift()) {
        let strLength = Buffer.byteLength(str, 'utf8');
        if (length + str.length <= max) {
            cur.push(str);
            length += strLength;
        }
        else if (cur.length) {
            batches.push(cur);
            cur = [str];
            length = strLength;
        }
        else {
            debug('STRING TOO LONG!', str);
            throw new Error(`string length (${strLength}) exceeds max (${max})`);
        }
    }
    if (cur.length) {
        batches.push(cur);
    }
    return batches;
}
exports.batchStringsBySize = batchStringsBySize;
exports.RESOLVED_PROMISE = Promise.resolve();
exports.promiseNoop = () => exports.RESOLVED_PROMISE;
function defineGetter(obj, property, get) {
    Object.defineProperty(obj, property, {
        get,
        enumerable: true
    });
}
exports.defineGetter = defineGetter;
exports.race = Promise.race;
function parseArn(arn) {
    const parts = arn.split(':');
    return {
        service: parts[2],
        region: parts[3],
        accountId: parts[4],
        relativeId: parts.slice(4).join(':')
    };
}
exports.parseArn = parseArn;
exports.getRecordsFromEvent = (event, oldAndNew) => {
    return event.Records.map(record => {
        const { NewImage, OldImage } = record.dynamodb;
        if (oldAndNew) {
            return {
                old: OldImage && dynamodb_marshaler_1.unmarshalItem(OldImage),
                new: NewImage && dynamodb_marshaler_1.unmarshalItem(NewImage)
            };
        }
        return NewImage && dynamodb_marshaler_1.unmarshalItem(NewImage);
    })
        .filter(data => data);
};
exports.marshalDBItem = dynamodb_marshaler_1.marshalItem;
exports.unmarshalDBItem = dynamodb_marshaler_1.unmarshalItem;
exports.applyFunction = (fn, context, args) => {
    if (!context)
        context = this;
    if (isGenerator(fn)) {
        return co_1.wrap(fn).apply(context, args);
    }
    return fn.apply(context, args);
};
exports.wrap = (fn) => {
    return function (...args) {
        return __awaiter(this, void 0, void 0, function* () {
            const callback = args.pop();
            let ret;
            try {
                ret = exports.applyFunction(fn, this, args);
                if (isPromise(ret))
                    ret = yield ret;
            }
            catch (err) {
                return callback(err);
            }
            callback(null, ret);
        });
    };
};
exports.networkFromIdentifier = str => {
    const [flavor, networkName] = str.split(':');
    const networks = require('./networks');
    const forFlavor = networks[flavor] || {};
    return forFlavor[networkName];
};
exports.summarizeObject = object => {
    const links = buildResource.links(object);
    const summary = Object.assign({}, links, { type: object[constants_1.TYPE] });
    if (object[constants_1.TYPE] === 'tradle.Message') {
        summary.payload = exports.summarizeObject(object.object);
    }
    return summary;
};
exports.uniqueStrict = arr => {
    const map = new Map();
    const uniq = [];
    for (const item of arr) {
        if (!map.has(item)) {
            map.set(item, true);
            uniq.push(item);
        }
    }
    return uniq;
};
exports.getRequestIps = (req) => {
    return [
        req.ip,
        req.get('x-forwarded-for'),
        req.get('x-real-ip')
    ].filter(notNull);
};
exports.createLambdaContext = (fun, cb) => {
    const functionName = fun.name;
    const endTime = new Date().getTime() + (fun.timeout ? fun.timeout * 1000 : 6000);
    const done = typeof cb === 'function' ? cb : ((x, y) => x || y);
    return {
        done,
        succeed: res => done(null, res),
        fail: err => done(err, null),
        getRemainingTimeInMillis: () => endTime - new Date().getTime(),
        functionName,
        memoryLimitInMB: fun.memorySize,
        functionVersion: `offline_functionVersion_for_${functionName}`,
        invokedFunctionArn: `offline_invokedFunctionArn_for_${functionName}`,
        awsRequestId: `offline_awsRequestId_${Math.random().toString(10).slice(2)}`,
        logGroupName: `offline_logGroupName_for_${functionName}`,
        logStreamName: `offline_logStreamName_for_${functionName}`,
        identity: {},
        clientContext: {}
    };
};
exports.logResponseBody = (logger) => (req, res, next) => {
    const oldWrite = res.write;
    const oldEnd = res.end;
    const chunks = [];
    res.write = function (chunk) {
        chunks.push(chunk);
        oldWrite.apply(res, arguments);
    };
    res.end = function (chunk) {
        if (chunk)
            chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('utf8');
        logger.debug('RESPONSE BODY', {
            path: req.path,
            body
        });
        oldEnd.apply(res, arguments);
    };
    next();
};
exports.ensureTimestamped = (resource) => {
    if (!resource._time) {
        setVirtual(resource, {
            _time: resource.time || Date.now()
        });
    }
    return resource;
};
exports.cachifyFunction = (container, method) => {
    const original = container[method];
    const { cache, logger } = container;
    const cachified = (...args) => __awaiter(this, void 0, void 0, function* () {
        const str = string_utils_1.stableStringify(args);
        const cached = cache.get(str);
        if (cached) {
            if (isPromise(cached)) {
                return cached.catch(err => cachified(...args));
            }
            logger.debug('cache hit', str);
            return cached;
        }
        logger.debug('cache miss', str);
        const result = original.apply(container, args);
        if (isPromise(result)) {
            result.catch(err => cache.del(str));
        }
        cache.set(str, result);
        return result;
    });
    return cachified;
};
exports.timeMethods = (obj, logger) => {
    logger = logger.sub('timer');
    Object.keys(obj).forEach(key => {
        const val = obj[key];
        if (typeof val !== 'function')
            return;
        obj[key] = (...args) => {
            const start = Date.now();
            const log = () => {
                logger.debug({
                    fn: key,
                    args: JSON.stringify(args).slice(0, 100),
                    time: Date.now() - start
                });
            };
            const ret = val.apply(obj, args);
            if (isPromise(ret)) {
                ret.then(log, log);
            }
            return ret;
        };
    });
    return obj;
};
//# sourceMappingURL=utils.js.map