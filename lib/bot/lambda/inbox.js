"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const compose = require("koa-compose");
const cors = require("kcors");
const body_parser_1 = require("../middleware/body-parser");
const noop_route_1 = require("../middleware/noop-route");
const lambda_1 = require("../../lambda");
const onmessage_1 = require("../middleware/onmessage");
exports.createLambda = (opts) => {
    const lambda = opts.bot.createLambda(Object.assign({ source: lambda_1.EventSource.HTTP }, opts));
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
        onmessage_1.preProcessInbox(lambda, opts),
        onmessage_1.onmessage(lambda, opts),
        noop_route_1.route(['put', 'post'], '/inbox')
    ]);
};
//# sourceMappingURL=inbox.js.map