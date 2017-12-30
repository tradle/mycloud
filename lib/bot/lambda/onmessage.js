"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const compose = require("koa-compose");
const lambda_1 = require("../lambda");
const oniotmessage_1 = require("../middleware/oniotmessage");
const onmessage_1 = require("../middleware/onmessage");
const onmessagessaved_1 = require("../middleware/onmessagessaved");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromLambda(opts);
    lambda.tasks.add({
        name: 'getiotendpoint',
        promiser: lambda.bot.iot.getEndpoint
    });
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    return compose([
        oniotmessage_1.onMessage(lambda, opts),
        onmessage_1.onMessage(lambda, {
            onSuccess: oniotmessage_1.createSuccessHandler(lambda, opts),
            onError: oniotmessage_1.createErrorHandler(lambda, opts)
        }),
        onmessagessaved_1.onMessagesSaved(lambda, opts)
    ]);
};
//# sourceMappingURL=onmessage.js.map