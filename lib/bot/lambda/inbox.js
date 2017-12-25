"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const compose = require("koa-compose");
const cors = require("kcors");
const body_parser_1 = require("../middleware/body-parser");
const lambda_1 = require("../lambda");
const Inbox = require("../middleware/inbox");
const onmessage_1 = require("../middleware/onmessage");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromHTTP(opts);
    lambda.tasks.add({
        name: 'getiotendpoint',
        promiser: lambda.bot.iot.getEndpoint
    });
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    return compose([
        cors(),
        body_parser_1.bodyParser({ jsonLimit: '10mb' }),
        Inbox.preProcess(lambda, opts),
        onmessage_1.onmessage(lambda, opts)
    ]);
};
//# sourceMappingURL=inbox.js.map