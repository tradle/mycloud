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
const Router = require("koa-router");
const graphql_1 = require("graphql");
const printer_1 = require("graphql/language/printer");
const parser_1 = require("graphql/language/parser");
const graphqlHTTP = require("koa-graphql");
const dynamodb_1 = require("@tradle/dynamodb");
const schema_graphql_1 = require("@tradle/schema-graphql");
const constants_1 = require("@tradle/constants");
const logger_1 = require("../../logger");
const utils_1 = require("../../utils");
const { MESSAGE } = constants_1.TYPES;
const prettifyQuery = query => printer_1.print(parser_1.parse(query));
exports.createRouter = (opts) => {
    const { bot, logger } = opts;
    let graphiqlOptions = {};
    let api;
    bot.promiseReady().then(() => {
        api = exports.getGraphqlAPI(opts);
    });
    const handler = graphqlHTTP((req) => __awaiter(this, void 0, void 0, function* () {
        logger.debug(`hit graphql query route, ready: ${bot.isReady()}`);
        yield bot.promiseReady();
        const { query } = req.body;
        if (query && query.indexOf('query IntrospectionQuery') === -1) {
            logger.debug('received query:');
            logger.debug(prettifyQuery(req.body.query));
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
    const router = new Router();
    router.setGraphiqlOptions = options => graphiqlOptions = options;
    router.getGraphqlAPI = () => exports.getGraphqlAPI(opts);
    if (logger.level >= logger_1.Level.SILLY) {
        router.use(utils_1.logResponseBody(logger));
    }
    router.get('/graphql', handler);
    router.post('/graphql', handler);
    return router;
};
exports.getGraphqlAPI = (opts) => {
    const { bot, logger } = opts;
    let { objects, models, db } = bot;
    const postProcess = (result, op) => __awaiter(this, void 0, void 0, function* () {
        if (!result)
            return result;
        if (Array.isArray(result) && !result.length) {
            return result;
        }
        switch (op) {
            case 'get':
                if (result[constants_1.TYPE] === MESSAGE) {
                    yield loadPayloads(result);
                }
                presignEmbeddedMediaLinks(result);
                break;
            case 'list':
                if (result.items && result.items.length) {
                    if (result.items[0][constants_1.TYPE] === MESSAGE) {
                        yield loadPayloads(result.items);
                    }
                }
                result.items = presignEmbeddedMediaLinks(result.items);
                break;
            default:
                break;
        }
        return result;
    });
    let resolvers;
    let schema;
    const getSchema = (() => {
        return () => {
            if (!schema) {
                resolvers = dynamodb_1.createResolvers({
                    objects,
                    models,
                    db,
                    postProcess
                });
                schema = schema_graphql_1.createSchema({ models, objects, resolvers }).schema;
            }
            return schema;
        };
    })();
    const executeQuery = (query, variables) => __awaiter(this, void 0, void 0, function* () {
        yield bot.promiseReady();
        return graphql_1.graphql(getSchema(), query, null, {}, variables);
    });
    const loadPayloads = (messages) => __awaiter(this, void 0, void 0, function* () {
        const now = Date.now();
        messages = [].concat(messages);
        const payloads = yield Promise.all(messages.map(msg => objects.get(msg.object._link)));
        payloads.forEach((payload, i) => {
            const neutered = messages[i].object;
            const virtual = utils_1.uniqueStrict((neutered._virtual || []).concat(payload._virtual || []));
            Object.assign(neutered, payload);
            neutered._virtual = virtual;
        });
        const time = Date.now() - now;
        logger.debug(`loading message payloads took: ${time}ms`);
    });
    const setModels = (_models) => {
        models = _models;
        schema = getSchema();
    };
    bot.on('models', setModels);
    const presignEmbeddedMediaLinks = (items) => {
        if (!items)
            return items;
        [].concat(items).forEach(object => {
            objects.presignEmbeddedMediaLinks({
                object,
                stripEmbedPrefix: true
            });
        });
        return items;
    };
    if (models)
        setModels(models);
    return {
        setModels,
        get schema() {
            return getSchema();
        },
        get resolvers() {
            getSchema();
            return resolvers;
        },
        db,
        executeQuery
    };
};
//# sourceMappingURL=graphql.js.map