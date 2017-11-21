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
const pick = require("object.pick");
const _1 = require("../../../");
const bot_1 = require("../../bot");
const graphql_1 = require("../../../bot/graphql");
const sample_queries_1 = require("../../sample-queries");
const tradle = _1.createTradle();
const gql = graphql_1.setupGraphQL(pick(tradle, [
    'env',
    'router',
    'objects',
    'db'
]));
exports.handler = tradle.createHttpHandler();
(() => __awaiter(this, void 0, void 0, function* () {
    const { bot, conf, productsAPI } = yield bot_1.createBot(tradle);
    const { org } = yield conf.getPrivateConf();
    gql.setGraphiqlOptions({
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
    gql.setModels(productsAPI.models.all);
}))();
//# sourceMappingURL=graphql.js.map