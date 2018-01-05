"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lambda_1 = require("../lambda");
const onmessagestream_1 = require("../middleware/onmessagestream");
const MODELS_PACK = 'tradle.ModelsPack';
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromDynamoDB(opts);
    const { bot, tradle, tasks, logger } = lambda;
    tasks.add({
        name: 'getiotendpoint',
        promiser: bot.iot.getEndpoint
    });
    return lambda.use(onmessagestream_1.createMiddleware(lambda, opts));
};
//# sourceMappingURL=onmessagestream.js.map