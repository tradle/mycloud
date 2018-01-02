"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lambda_1 = require("../lambda");
const onmessagestream_1 = require("../middleware/onmessagestream");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromDynamoDB(opts);
    lambda.tasks.add({
        name: 'getiotendpoint',
        promiser: lambda.bot.iot.getEndpoint
    });
    return lambda.use(onmessagestream_1.createMiddleware(lambda, opts));
};
//# sourceMappingURL=onmessagestream.js.map