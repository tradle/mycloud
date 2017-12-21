"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lambda_1 = require("../lambda");
const graphql_1 = require("../graphql");
const utils_1 = require("../../utils");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromHTTP(opts);
    const router = exports.createRouter(lambda, opts);
    utils_1.defineGetter(lambda, 'setGraphQLAuth', () => router.setGraphQLAuth);
    utils_1.defineGetter(lambda, 'setGraphiqlOptions', () => router.setGraphiqlOptions);
    utils_1.defineGetter(lambda, 'getGraphiqlAPI', () => router.getGraphiqlAPI);
    return lambda.use(router.routes());
};
exports.createRouter = (lambda, opts) => graphql_1.createGraphQLRouter(lambda);
//# sourceMappingURL=graphql.js.map