"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lambda_1 = require("../../lambda");
const onmessage_1 = require("../middleware/onmessage");
exports.createLambda = (opts) => {
    return exports.outfitLambda(opts.bot.createLambda(Object.assign({ source: lambda_1.EventSource.LAMBDA }, opts)), opts);
};
exports.outfitLambda = (lambda, opts) => {
    lambda.tasks.add({
        name: 'getiotendpoint',
        promiser: lambda.bot.iot.getEndpoint
    });
    lambda.use(onmessage_1.onmessage(lambda, opts));
    return lambda;
};
//# sourceMappingURL=onmessage.js.map