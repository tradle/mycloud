"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const customize_1 = require("../../customize");
const sample_queries_1 = require("../../sample-queries");
const bot_1 = require("../../../bot");
const graphql_auth_1 = require("../../strategy/graphql-auth");
const bot = bot_1.createBot();
const lambda = bot.lambdas.graphql();
const { logger, handler } = lambda;
lambda.tasks.add({
    name: 'init',
    promiser: () => __awaiter(this, void 0, void 0, function* () {
        const { org, conf, productsAPI, employeeManager } = yield customize_1.customize({ bot, delayReady: true, event: 'graphql' });
        logger.debug('finished setting up bot graphql middleware');
        lambda.setGraphiqlOptions({
            logo: {
                src: org.logo,
                width: 32,
                height: 32
            },
            bookmarks: {
                title: 'Samples',
                items: sample_queries_1.default
            }
        });
        if (false) {
            graphql_auth_1.createGraphQLAuth({ bot, employeeManager });
        }
        bot.ready();
    })
});
module.exports = lambda;
//# sourceMappingURL=graphql.js.map