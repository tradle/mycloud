"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const lambda_1 = require("../../../lambda");
const customize_1 = require("../../customize");
const sample_queries_1 = require("../../sample-queries");
const bot_1 = require("../../../bot");
const graphql_1 = require("../../middleware/graphql");
const bot = bot_1.createBot({ ready: false });
const loadModelsPacks = bot.modelStore.loadModelsPacks();
const promiseCustomize = customize_1.customize({
    bot,
    delayReady: true,
    event: 'graphql'
})
    .then(components => {
    return Object.assign({}, components, { middleware: graphql_1.createMiddleware(lambda, components) });
});
const lambda = bot.createLambda({
    source: lambda_1.EventSource.HTTP,
    middleware: promiseCustomize.then(({ middleware }) => middleware)
});
const { logger, handler } = lambda;
const init = () => __awaiter(this, void 0, void 0, function* () {
    const components = yield promiseCustomize;
    const { style, middleware } = components;
    logger.debug('finished setting up bot graphql middleware');
    const opts = {
        bookmarks: {
            title: 'Samples',
            items: sample_queries_1.default
        },
        logo: null
    };
    if (style && style.logo) {
        opts.logo = {
            src: style.logo.url,
            width: 32,
            height: 32
        };
    }
    middleware.setGraphiqlOptions(opts);
    yield loadModelsPacks;
    bot.ready();
});
lambda.tasks.add({
    name: 'init',
    promiser: init
});
module.exports = lambda;
//# sourceMappingURL=graphql.js.map