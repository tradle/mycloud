"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lambda_1 = require("../../lambda");
const graphql_1 = require("../graphql");
const utils_1 = require("../../utils");
exports.createLambda = (opts) => {
    return exports.outfitLambda(opts.bot.createLambda(Object.assign({ source: lambda_1.EventSource.HTTP }, opts)), opts);
};
exports.outfitLambda = (lambda, opts) => {
    const router = graphql_1.createGraphQLRouter(lambda);
    lambda.use(router.routes());
    utils_1.defineGetter(lambda, 'setGraphQLAuth', () => router.setGraphQLAuth);
    utils_1.defineGetter(lambda, 'setGraphiqlOptions', () => router.setGraphiqlOptions);
    utils_1.defineGetter(lambda, 'getGraphiqlAPI', () => router.getGraphiqlAPI);
    return lambda;
};
//# sourceMappingURL=graphql.js.map