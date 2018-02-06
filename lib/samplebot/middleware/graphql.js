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
const cors = require("kcors");
const lodash_1 = require("lodash");
const body_parser_1 = require("../../bot/middleware/body-parser");
const graphql_1 = require("../../bot/middleware/graphql");
const graphql_auth_1 = require("../../bot/middleware/graphql-auth");
const keep_models_fresh_1 = require("../plugins/keep-models-fresh");
const constants_1 = require("../constants");
exports.keepModelsFresh = (lambda, components) => {
    const { bot } = lambda;
    const { productsAPI, employeeManager, } = components;
    const getModelsPackForUser = keep_models_fresh_1.createModelsPackGetter(Object.assign({ bot }, components));
    const sendModelsPackToUser = (user) => __awaiter(this, void 0, void 0, function* () {
        const modelsPack = yield getModelsPackForUser(user);
        if (!modelsPack)
            return;
        const sent = yield keep_models_fresh_1.sendModelsPackIfUpdated({
            user,
            modelsPack,
            send: object => bot.send({ to: user, object })
        });
        if (sent) {
            lambda.tasks.add({
                name: 'saveuser',
                promise: bot.users.merge(lodash_1.pick(user, ['id', constants_1.MODELS_HASH_PROPERTY]))
            });
        }
    });
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { user } = ctx;
        if (user) {
            yield sendModelsPackToUser(user);
        }
        yield next();
    });
};
exports.createAuth = (lambda, components) => {
    const allowGuest = lambda.stage === 'dev';
    const { employeeManager } = components;
    return graphql_auth_1.createHandler(lambda, {
        allowGuest,
        canUserRunQuery: ({ user, query }) => {
            return allowGuest || (user && employeeManager.isEmployee(user));
        }
    });
};
exports.createMiddleware = (lambda, components) => {
    const { handler, setGraphiqlOptions, getGraphqlAPI } = graphql_1.createHandler(lambda, components);
    const middleware = compose([
        cors(),
        body_parser_1.bodyParser({ jsonLimit: '10mb' }),
        exports.createAuth(lambda, components),
        exports.keepModelsFresh(lambda, components),
        handler
    ]);
    return {
        middleware,
        setGraphiqlOptions,
        getGraphqlAPI
    };
};
//# sourceMappingURL=graphql.js.map