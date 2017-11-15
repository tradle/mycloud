"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const coexpress = require("co-express");
const graphql_1 = require("graphql");
const printer_1 = require("graphql/language/printer");
const parser_1 = require("graphql/language/parser");
const expressGraphQL = require("express-graphql");
const dynogels = require("dynogels");
const dynamodb_1 = require("@tradle/dynamodb");
const schema_graphql_1 = require("@tradle/schema-graphql");
const constants_1 = require("@tradle/constants");
const { MESSAGE } = constants_1.TYPES;
const prettifyQuery = query => printer_1.print(parser_1.parse(query));
dynogels.log = {
    info: require('debug')('dynogels:info'),
    warn: require('debug')('dynogels:warn'),
    level: 'warn'
};
module.exports = function setup(opts) {
    const { env, router, models, objects, db, } = opts;
    const { debug } = env;
    debug('attaching /graphql route');
    let auth;
    let graphiqlOptions;
    const setAuth = authImpl => auth = authImpl;
    const setGraphiqlOptions = options => graphiqlOptions = options;
    router.use('/graphql', coexpress(function* (req, res, next) {
        if (auth) {
            yield auth(req, res, next);
        }
        else {
            next();
        }
    }));
    router.use('/graphql', expressGraphQL(req => {
        const { query } = req.body;
        if (query && query.indexOf('query IntrospectionQuery') === -1) {
            debug('received query:');
            debug(prettifyQuery(req.body.query));
        }
        return {
            schema: getSchema(),
            graphiql: graphiqlOptions,
            formatError: err => {
                console.error('experienced error executing GraphQL query', err.stack);
                return graphql_1.formatError(err);
            }
        };
    }));
    router.use(router.defaultErrorHandler);
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
    const resolvers = dynamodb_1.createResolvers({
        objects,
        models,
        db,
        postProcess
    });
    const getSchema = (() => {
        let schema;
        return () => {
            if (!schema) {
                schema = schema_graphql_1.createSchema({ models, objects, resolvers }).schema;
            }
            return schema;
        };
    })();
    const executeQuery = (query, variables) => {
        const schema = getSchema();
        return graphql_1.graphql(schema, query, null, {}, variables);
    };
    const loadPayloads = (messages) => __awaiter(this, void 0, void 0, function* () {
        messages = [].concat(messages);
        const payloads = yield Promise.all(messages.map(msg => objects.get(msg.object._link)));
        payloads.forEach((payload, i) => {
            const neutered = messages[i].object;
            const virtual = (neutered._virtual || []).concat(payload._virtual || []);
            Object.assign(neutered, payload);
            neutered._virtual = virtual;
        });
    });
    return {
        get schema() {
            return getSchema();
        },
        db,
        resolvers,
        executeQuery,
        setAuth,
        setGraphiqlOptions
    };
    function presignEmbeddedMediaLinks(items) {
        if (!items)
            return items;
        [].concat(items).forEach(object => {
            objects.presignEmbeddedMediaLinks({
                object,
                stripEmbedPrefix: true
            });
        });
        return items;
    }
};
//# sourceMappingURL=graphql.js.map