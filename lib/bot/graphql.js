"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const debug = require('debug')('tradle:sls:graphql');
const coexpress = require('co-express');
const { graphql, formatError } = require('graphql');
const expressGraphQL = require('express-graphql');
const dynogels = require('dynogels');
const { createResolvers } = require('@tradle/dynamodb');
const { createSchema } = require('@tradle/schema-graphql');
const { SIG, TYPE, TYPES } = require('@tradle/constants');
const Errors = require('../errors');
const { MESSAGE } = TYPES;
dynogels.log = {
    info: require('debug')('dynogels:info'),
    warn: require('debug')('dynogels:warn'),
    level: 'warn'
};
module.exports = function setup(opts) {
    const { env, router, models, objects, identities, db, utils, constants } = opts;
    const { TESTING } = env;
    debug('attaching /graphql route');
    let auth;
    const setAuth = authImpl => auth = authImpl;
    router.use('/graphql', coexpress(function* (req, res, next) {
        if (auth) {
            yield auth(req, res, next);
        }
        else {
            next();
        }
    }));
    router.use('/graphql', expressGraphQL(() => ({
        schema: getSchema(),
        graphiql: true,
        formatError: err => {
            console.error('experienced error executing GraphQL query', err.stack);
            return formatError(err);
        }
    })));
    router.use(router.defaultErrorHandler);
    const postProcess = (result, op) => __awaiter(this, void 0, void 0, function* () {
        if (!result)
            return result;
        if (Array.isArray(result) && !result.length) {
            return result;
        }
        switch (op) {
            case 'get':
                if (result[TYPE] === MESSAGE) {
                    yield loadPayloads(result);
                }
                presignEmbeddedMediaLinks(result);
                break;
            case 'list':
                if (result.items && result.items.length) {
                    if (result.items[0][TYPE] === MESSAGE) {
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
    const resolvers = createResolvers({
        objects,
        models,
        db,
        postProcess
    });
    let schema;
    const getSchema = () => {
        if (!schema) {
            schema = createSchema({ models, objects, resolvers }).schema;
        }
        return schema;
    };
    const executeQuery = (query, variables) => {
        const schema = getSchema();
        return graphql(schema, query, null, {}, variables);
    };
    const loadPayloads = (messages) => __awaiter(this, void 0, void 0, function* () {
        messages = [].concat(messages);
        const payloads = yield Promise.all(messages.map(msg => objects.getObjectByLink(msg.object._link)));
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
        setAuth
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