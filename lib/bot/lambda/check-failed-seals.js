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
const lambda_1 = require("../../lambda");
const SIX_HOURS = 6 * 3600 * 1000;
exports.createLambda = (opts) => {
    const lambda = opts.bot.createLambda(Object.assign({ source: lambda_1.EventSource.SCHEDULE }, opts));
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts = {}) => {
    const { gracePeriod = SIX_HOURS } = opts;
    const { seals } = lambda.tradle;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        ctx.seals = yield seals.handleFailures({ gracePeriod });
        yield next();
    });
};
//# sourceMappingURL=check-failed-seals.js.map