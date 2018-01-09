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
const compose = require("koa-compose");
const graphqlHTTP = require("koa-graphql");
const graphql_1 = require("graphql");
const ModelsPack = require("@tradle/models-pack");
const noop_route_1 = require("./noop-route");
const logger_1 = require("../../logger");
const utils_1 = require("../../utils");
const graphql_2 = require("../graphql");
exports.createHandler = (opts) => {
    const { bot, logger } = opts;
    let graphiqlOptions = {};
    let api;
    let modelsVersionId;
    const { modelStore } = bot;
    const updateVersionId = (models) => {
        modelsVersionId = ModelsPack.versionId(models);
    };
    bot.promiseReady().then(() => {
        api = graphql_2.getGraphqlAPI(opts);
    });
    if (modelStore.models)
        updateVersionId(modelStore.models);
    modelStore.on('update', updateVersionId);
    const handler = graphqlHTTP((req) => __awaiter(this, void 0, void 0, function* () {
        logger.debug(`hit graphql query route, ready: ${bot.isReady()}`);
        yield bot.promiseReady();
        const { query, variables } = req.body;
        if (query && query.indexOf('query IntrospectionQuery') === -1) {
            logger.debug('received query:');
            logger.debug(graphql_2.prettifyQuery(req.body.query));
        }
        if (variables && variables.modelsVersionId) {
            if (modelsVersionId !== variables.modelsVersionId) {
                throw new Error(`expected models with versionId: ${modelsVersionId}`);
            }
        }
        return {
            get schema() { return api.schema; },
            graphiql: graphiqlOptions,
            formatError: err => {
                console.error('experienced error executing GraphQL query', err.stack);
                return graphql_1.formatError(err);
            }
        };
    }));
    const middleware = [
        noop_route_1.route(['get', 'post']),
        handler
    ];
    if (logger.level >= logger_1.Level.SILLY) {
        middleware.push(utils_1.logResponseBody(logger));
    }
    const stack = compose(middleware);
    stack.setGraphiqlOptions = options => graphiqlOptions = options;
    stack.getGraphqlAPI = () => graphql_2.getGraphqlAPI(opts);
    return stack;
};
//# sourceMappingURL=graphql.js.map