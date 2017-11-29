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
process.env.LAMBDA_BIRTH_DATE = Date.now();
const customize_1 = require("../../customize");
const sample_queries_1 = require("../../sample-queries");
const bot_1 = require("../../../bot");
const bot = bot_1.createBot();
exports.bot = bot;
const graphqlAPI = bot.getGraphqlAPI();
const handler = bot.createHttpHandler();
exports.handler = handler;
(() => __awaiter(this, void 0, void 0, function* () {
    const { conf, productsAPI } = yield customize_1.customize({ bot, delayReady: true });
    const { org } = conf;
    graphqlAPI.setGraphiqlOptions({
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
    bot.ready();
}))();
//# sourceMappingURL=graphql.js.map