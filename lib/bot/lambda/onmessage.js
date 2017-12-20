"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const compose = require("koa-compose");
const lambda_1 = require("../../lambda");
const onmessage_1 = require("../middleware/onmessage");
exports.createLambda = (opts) => {
    const lambda = opts.bot.createLambda(Object.assign({ source: lambda_1.EventSource.LAMBDA }, opts));
    lambda.tasks.add({
        name: 'getiotendpoint',
        promiser: lambda.bot.iot.getEndpoint
    });
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    return compose([
        onmessage_1.preProcessIotMessage(lambda, opts),
        onmessage_1.onmessage(lambda, opts)
    ]);
};
//# sourceMappingURL=onmessage.js.map