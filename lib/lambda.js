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
const dateOfBirth = Date.now();
require('source-map-support').install();
require("./globals");
const events_1 = require("events");
const _ = require("lodash");
const Promise = require("bluebird");
const compose = require("koa-compose");
const caseless = require("caseless");
const randomName = require("random-name");
const string_utils_1 = require("./string-utils");
const crypto_1 = require("./crypto");
const Errors = require("./errors");
const utils_1 = require("./utils");
const warmup_1 = require("./middleware/warmup");
const NOT_FOUND = new Error('nothing here');
var EventSource;
(function (EventSource) {
    EventSource["HTTP"] = "http";
    EventSource["LAMBDA"] = "lambda";
    EventSource["DYNAMODB"] = "dynamodb";
    EventSource["IOT"] = "iot";
    EventSource["CLOUDFORMATION"] = "cloudformation";
    EventSource["SCHEDULE"] = "schedule";
    EventSource["S3"] = "s3";
    EventSource["CLI"] = "cli";
})(EventSource = exports.EventSource || (exports.EventSource = {}));
exports.fromHTTP = (opts = {}) => new Lambda(Object.assign({}, opts, { source: EventSource.HTTP }));
exports.fromDynamoDB = (opts = {}) => new Lambda(Object.assign({}, opts, { source: EventSource.DYNAMODB }));
exports.fromIot = (opts = {}) => new Lambda(Object.assign({}, opts, { source: EventSource.IOT }));
exports.fromSchedule = (opts = {}) => new Lambda(Object.assign({}, opts, { source: EventSource.SCHEDULE }));
exports.fromCloudFormation = (opts = {}) => new Lambda(Object.assign({}, opts, { source: EventSource.CLOUDFORMATION }));
exports.fromLambda = (opts = {}) => new Lambda(Object.assign({}, opts, { source: EventSource.LAMBDA }));
exports.fromS3 = (opts = {}) => new Lambda(Object.assign({}, opts, { source: EventSource.S3 }));
exports.fromCli = (opts = {}) => new Lambda(Object.assign({}, opts, { source: EventSource.CLI }));
class Lambda extends events_1.EventEmitter {
    constructor(opts = {}) {
        super();
        this.use = (fn) => {
            if (this._gotHandler) {
                console.warn('adding middleware after exporting the lambda handler ' +
                    'can result in unexpected behavior');
            }
            if (utils_1.isPromise(fn)) {
                fn = promiseMiddleware(fn);
            }
            if (typeof fn !== 'function') {
                throw new Error('middleware must be a function!');
            }
            if (this.source === EventSource.HTTP) {
                this.koa.use(fn);
            }
            else {
                this.middleware.push(fn);
            }
            return this;
        };
        this.exit = (err, result) => __awaiter(this, void 0, void 0, function* () {
            if (this.done) {
                throw new Error(`exit can only be called once per lambda invocation!
Previous exit stack: ${this.lastExitStack}`);
            }
            this.lastExitStack = new Error('exit').stack;
            this.logger.debug('preparing for exit', {
                requestTime: this.executionTime,
                timeLeft: this.timeLeft
            });
            const ctx = this.execCtx;
            ctx.done = true;
            const { shortName } = this;
            const start = Date.now();
            const timeout = utils_1.timeoutIn({
                millis: Math.max(this.timeLeft - 200, 0),
                get error() {
                    const time = Date.now() - start;
                    return new Errors.ExecutionTimeout(`lambda ${shortName} timed out after ${time}ms waiting for async tasks to complete`);
                }
            });
            try {
                yield Promise.race([
                    this.finishAsyncTasks(),
                    timeout
                ]);
            }
            catch (err) {
                const tasks = this.tasks.describe();
                if (Errors.matches(err, Errors.ExecutionTimeout)) {
                    this.logger.error('async tasks timed out', { tasks });
                }
                else {
                    this.logger.error('async tasks failed', Object.assign({ tasks }, Errors.export(err)));
                }
            }
            timeout.cancel();
            if (this.bot && !this.bot.isReady()) {
                this.breakingContext = string_utils_1.safeStringify({
                    execCtx: this.execCtx,
                    reqCtx: this.reqCtx,
                    tasks: this.tasks.describe()
                });
                this._ensureNotBroken();
            }
            if (err) {
                ctx.error = err;
            }
            else {
                err = ctx.error;
            }
            if (err) {
                if (Errors.isDeveloperError(err)) {
                    this.logger.warn('likely developer error', Errors.export(err));
                }
                ctx.body = this._exportError(err);
                this.logger.debug('lambda execution hit an error', { stack: err.stack });
            }
            else if (result) {
                ctx.body = result;
            }
            this.emit('done');
            this.isVirgin = false;
            this.logger.debug('exiting');
            if (this.source !== EventSource.HTTP) {
                if (!ctx.callback) {
                    throw new Error('lambda already exited');
                }
                ctx.callback(ctx.error, ctx.body);
            }
            this.reset();
        });
        this.run = () => __awaiter(this, void 0, void 0, function* () {
            this.emit('run');
            const exec = compose(this.middleware);
            const ctx = this.execCtx;
            if (!ctx)
                throw new Error('missing execution context');
            try {
                yield exec(ctx);
            }
            catch (err) {
                if (ctx.error) {
                    this.logger.error('error in execution', err.stack);
                }
                else {
                    ctx.error = err;
                }
            }
            if (!this.done)
                this.exit();
        });
        this.preProcess = ({ event, context, request, callback }) => __awaiter(this, void 0, void 0, function* () {
            yield this.initPromise;
            this._ensureNotBroken();
            if (!this.accountId) {
                const { invokedFunctionArn } = context;
                if (invokedFunctionArn) {
                    const { accountId } = utils_1.parseArn(invokedFunctionArn);
                    this.accountId = accountId;
                }
            }
            context.callbackWaitsForEmptyEventLoop = false;
            this.logger = this.tradle.logger.sub({
                namespace: `λ:${this.shortName}`,
                context: this.reqCtx,
                writer: console
            });
            if (this.source === EventSource.LAMBDA &&
                event.requestContext &&
                event.payload) {
                this.reqCtx = event.requestContext;
                event = event.payload;
            }
            if (this.source === EventSource.HTTP) {
                if (typeof event.body === 'string') {
                    const enc = event.isBase64Encoded ? 'base64' : 'utf8';
                    event.body = new Buffer(event.body, enc);
                }
                const headers = caseless(request.headers);
                if (!this.isUsingServerlessOffline && headers.get('content-encoding') === 'gzip') {
                    this.logger.info('stripping content-encoding header as APIGateway already gunzipped');
                    headers.set('content-encoding', 'identity');
                    event.headers = request.headers;
                }
            }
            this.setExecutionContext({ event, context, callback });
            this.reqCtx = getRequestContext(this);
            this.env.setLambda(this);
        });
        this.finishAsyncTasks = () => __awaiter(this, void 0, void 0, function* () {
            const results = yield this.tasks.awaitAllSettled();
            const failed = results.filter(r => r.reason);
            if (failed.length) {
                this.logger.warn(`${failed.length} async tasks failed`, {
                    failed: failed.map(({ reason, task }) => ({ reason, task }))
                });
            }
        });
        this._initHttp = () => {
            const Koa = require('koa');
            this.koa = new Koa();
            this.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
                const { execCtx } = this;
                this.execCtx = ctx;
                const overwritten = _.pick(execCtx, Object.keys(ctx));
                if (Object.keys(overwritten).length) {
                    this.logger.warn('overwriting these properties on execution context', overwritten);
                }
                Object.assign(this.execCtx, execCtx);
                this.emit('run');
                if (!this.done) {
                    try {
                        yield next();
                    }
                    catch (err) {
                        ctx.error = err;
                    }
                }
                if (!ctx.body) {
                    ctx.body = {};
                }
                yield this.exit();
            }));
            if (!this.isTesting) {
                this.use(require('koa-compress')());
            }
            utils_1.defineGetter(this, 'body', () => {
                const { body = {} } = this.execCtx.event;
                return typeof body === 'string' ? JSON.parse(body) : body;
            });
            utils_1.defineGetter(this, 'queryParams', () => {
                return this.execCtx.event.queryStringParameters || {};
            });
            utils_1.defineGetter(this, 'params', () => {
                return this.execCtx.event.pathParameters || {};
            });
        };
        this.invoke = (event) => __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                const callback = (err, result) => {
                    if (err)
                        return reject(err);
                    resolve(resolve);
                };
                const context = utils_1.createLambdaContext({
                    name: this.shortName,
                }, callback);
                this.handler(event, context, callback);
            });
        });
        this.setExecutionContext = (_a) => {
            var { event, context, callback } = _a, opts = __rest(_a, ["event", "context", "callback"]);
            this.execCtx = Object.assign({}, opts, { done: false, event, context: Object.assign({}, context, { done: this.exit, succeed: result => this.exit(null, result), fail: this.exit }), callback: wrapCallback(this, callback || context.done.bind(context)) });
            return this.execCtx;
        };
        this.init = () => {
            this.initPromise = utils_1.syncClock(this.tradle);
        };
        this._exportError = (err) => {
            if (this.isTesting) {
                return Errors.export(err);
            }
            return {
                message: 'execution failed'
            };
        };
        this._ensureNotBroken = () => {
            if (!this.isTesting && this.breakingContext) {
                throw new Error('I am broken!: ' + this.breakingContext);
            }
        };
        const { tradle = require('./').tradle, source } = opts;
        this.opts = opts;
        this.tradle = tradle;
        this.env = tradle.env;
        this.tasks = tradle.tasks;
        this.source = opts.source;
        this.middleware = [];
        this.isVirgin = true;
        this.containerId = `${randomName.first()} ${randomName.middle()} ${randomName.last()} ${crypto_1.randomString(6)}`;
        if (opts.source == EventSource.HTTP) {
            this._initHttp();
        }
        this.requestCounter = 0;
        this.exit = this.exit.bind(this);
        this.reset();
        this._gotHandler = false;
        if (opts.devModeOnly) {
            this.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
                if (!this.isTesting)
                    throw new Error('forbidden');
                yield next();
            }));
        }
        this.use(warmup_1.warmup(this));
        if (source !== EventSource.CLOUDFORMATION) {
            this.tasks.add({
                name: 'warmup:cache',
                promiser: () => tradle.warmUpCaches()
            });
        }
        this.init();
        process.nextTick(() => {
            if (!this._gotHandler) {
                console.warn(`did you forget to export "${this.shortName}" lambda's handler?`);
            }
        });
    }
    get name() {
        return this.env.AWS_LAMBDA_FUNCTION_NAME;
    }
    get shortName() {
        return this.env.FUNCTION_NAME;
    }
    get stage() {
        return this.env.SERVERLESS_STAGE;
    }
    get requestId() {
        return this.reqCtx.requestId;
    }
    get correlationId() {
        return this.reqCtx.correlationId;
    }
    get dateOfBirth() {
        return dateOfBirth;
    }
    get containerAge() {
        return Date.now() - dateOfBirth;
    }
    get executionTime() {
        return this.reqCtx ? Date.now() - this.reqCtx.start : 0;
    }
    get done() {
        return !this.execCtx || this.execCtx.done;
    }
    get timeLeft() {
        if (this.execCtx) {
            if (this.isTesting) {
                return 5000;
            }
            const { context } = this.execCtx;
            if (context && context.getRemainingTimeInMillis) {
                return Math.max(context.getRemainingTimeInMillis(), 0);
            }
        }
        return 0;
    }
    get isTesting() {
        return this.env.TESTING;
    }
    get isUsingServerlessOffline() {
        return this.env.IS_OFFLINE;
    }
    get isProd() {
        return this.stage === 'prod';
    }
    reset() {
        this.reqCtx = null;
        this.execCtx = null;
        this.lastExitStack = null;
        this.logger = this.tradle.logger.sub({
            namespace: this.env.FUNCTION_NAME,
            writer: console
        });
    }
    get handler() {
        this._gotHandler = true;
        if (this.source === EventSource.HTTP) {
            const { createHandler } = require('./http-request-handler');
            return createHandler({
                lambda: this,
                preProcess: (request, event, context) => this.preProcess({ request, event, context }),
                postProcess: (response, event, context) => { }
            });
        }
        return (event, context, callback) => __awaiter(this, void 0, void 0, function* () {
            yield this.preProcess({ event, context, callback });
            yield this.run();
        });
    }
}
exports.Lambda = Lambda;
const wrapCallback = (lambda, callback) => (err, result) => {
    if (lambda.done) {
        callback(err, result);
    }
    else {
        lambda.exit(err, result);
    }
};
const getRequestContext = (lambda) => {
    const { execCtx } = lambda;
    const { event, context } = execCtx;
    const correlationId = lambda.source === EventSource.HTTP
        ? event.requestContext.requestId
        : context.awsRequestId;
    const ctx = Object.assign({}, (lambda.reqCtx || {}), { seq: lambda.requestCounter++, requestId: context.awsRequestId, correlationId, containerId: lambda.containerId, start: Date.now() });
    if (lambda.bot) {
        utils_1.defineGetter(ctx, 'botReady', () => lambda.bot.isReady());
    }
    if (lambda.env._X_AMZN_TRACE_ID) {
        ctx['trace-id'] = lambda.env._X_AMZN_TRACE_ID;
    }
    if (lambda.isUsingServerlessOffline) {
        ctx['function'] = lambda.env.FUNCTION_NAME;
    }
    if (lambda.isVirgin) {
        ctx.virgin = true;
    }
    return ctx;
};
const promiseMiddleware = promise => {
    let middleware;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        if (!middleware)
            middleware = yield promise;
        yield middleware(ctx, next);
    });
};
//# sourceMappingURL=lambda.js.map