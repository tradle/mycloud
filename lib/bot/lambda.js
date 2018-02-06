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
const lambda_1 = require("../lambda");
exports.EventSource = lambda_1.EventSource;
exports.createLambda = (_a) => {
    var { bot, middleware } = _a, lambdaOpts = __rest(_a, ["bot", "middleware"]);
    const lambda = new lambda_1.Lambda(lambdaOpts);
    lambda.bot = bot;
    bot.promiseReady().then(() => {
        lambda.logger.debug('bot is ready!');
    });
    lambda.tasks.add({
        name: 'bot:ready',
        promise: bot.promiseReady()
    });
    lambda.on('run', () => {
        if (!lambda.isVirgin && !bot.isReady()) {
            console.error('1. LAMBDA FAILED TO INITIALIZE ON FIRST RUN');
        }
    });
    lambda.on('done', () => {
        if (!bot.isReady()) {
            console.error('2. LAMBDA FAILED TO INITIALIZE ON FIRST RUN');
        }
    });
    lambda.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
        yield bot.promiseReady();
        yield next();
    }));
    if (middleware)
        lambda.use(middleware);
    return lambda;
};
exports.fromHTTP = (opts = {}) => exports.createLambda(Object.assign({}, opts, { source: lambda_1.EventSource.HTTP }));
exports.fromDynamoDB = (opts = {}) => exports.createLambda(Object.assign({}, opts, { source: lambda_1.EventSource.DYNAMODB }));
exports.fromIot = (opts = {}) => exports.createLambda(Object.assign({}, opts, { source: lambda_1.EventSource.IOT }));
exports.fromSchedule = (opts = {}) => exports.createLambda(Object.assign({}, opts, { source: lambda_1.EventSource.SCHEDULE }));
exports.fromCloudFormation = (opts = {}) => exports.createLambda(Object.assign({}, opts, { source: lambda_1.EventSource.CLOUDFORMATION }));
exports.fromLambda = (opts = {}) => exports.createLambda(Object.assign({}, opts, { source: lambda_1.EventSource.LAMBDA }));
exports.fromS3 = (opts = {}) => exports.createLambda(Object.assign({}, opts, { source: lambda_1.EventSource.S3 }));
exports.fromCli = (opts = {}) => exports.createLambda(Object.assign({}, opts, { source: lambda_1.EventSource.CLI }));
//# sourceMappingURL=lambda.js.map