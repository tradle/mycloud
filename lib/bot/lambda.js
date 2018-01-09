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
class Lambda extends lambda_1.Lambda {
    constructor(_a) {
        var { bot, middleware } = _a, lambdaOpts = __rest(_a, ["bot", "middleware"]);
        super(lambdaOpts);
        this.bot = bot;
        bot.lambda = this;
        this.promiseReady = bot.promiseReady;
        bot.promiseReady().then(() => {
            this.logger.debug('bot is ready!');
        });
        this.tasks.add({
            name: 'bot:ready',
            promise: this.promiseReady()
        });
        this.on('run', () => {
            if (!this.isVirgin && !bot.isReady()) {
                console.error('1. LAMBDA FAILED TO INITIALIZE ON FIRST RUN');
            }
        });
        this.on('done', () => {
            if (!bot.isReady()) {
                console.error('2. LAMBDA FAILED TO INITIALIZE ON FIRST RUN');
            }
        });
        this.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
            yield bot.promiseReady();
            yield next();
        }));
        if (middleware)
            this.use(middleware);
    }
}
exports.Lambda = Lambda;
exports.createLambda = (opts) => new Lambda(opts);
exports.fromHTTP = (opts = {}) => new Lambda(Object.assign({}, opts, { source: lambda_1.EventSource.HTTP }));
exports.fromDynamoDB = (opts = {}) => new Lambda(Object.assign({}, opts, { source: lambda_1.EventSource.DYNAMODB }));
exports.fromIot = (opts = {}) => new Lambda(Object.assign({}, opts, { source: lambda_1.EventSource.IOT }));
exports.fromSchedule = (opts = {}) => new Lambda(Object.assign({}, opts, { source: lambda_1.EventSource.SCHEDULE }));
exports.fromCloudFormation = (opts = {}) => new Lambda(Object.assign({}, opts, { source: lambda_1.EventSource.CLOUDFORMATION }));
exports.fromLambda = (opts = {}) => new Lambda(Object.assign({}, opts, { source: lambda_1.EventSource.LAMBDA }));
exports.fromS3 = (opts = {}) => new Lambda(Object.assign({}, opts, { source: lambda_1.EventSource.S3 }));
exports.fromCli = (opts = {}) => new Lambda(Object.assign({}, opts, { source: lambda_1.EventSource.CLI }));
//# sourceMappingURL=lambda.js.map