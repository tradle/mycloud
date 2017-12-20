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
exports.createLambda = (opts) => {
    const lambda = opts.bot.createLambda(Object.assign({ source: lambda_1.EventSource.IOT }, opts));
    lambda.tasks.add({
        name: 'getiotendpoint',
        promiser: lambda.bot.iot.getEndpoint
    });
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { logger, tradle } = lambda;
    const { user } = tradle;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        let { event } = ctx;
        if (Buffer.isBuffer(event)) {
            ctx.event = event = JSON.parse(event);
        }
        logger.debug('client subscribed', event);
        const { clientId, topics } = event;
        yield user.onSubscribed({ clientId, topics });
        yield next();
    });
};
//# sourceMappingURL=onsubscribe.js.map