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
const yn = require("yn");
const bot_1 = require("./bot");
const http_request_handler_1 = require("../http-request-handler");
const { IS_LAMBDA_ENVIRONMENT, NODE_ENV } = process.env;
if (NODE_ENV === 'test') {
    Object.assign(process.env, require('../test/service-map'), Object.assign({}, process.env));
}
if (yn(IS_LAMBDA_ENVIRONMENT) === false) {
    const { env } = require('../cli/serverless-yml').custom.brand;
    Object.assign(process.env, env);
}
const debug = require('debug')('λ:samplebot');
(() => __awaiter(this, void 0, void 0, function* () {
    const { bot, tradle, lambdas, productsAPI, employeeManager, onfidoPlugin } = yield bot_1.createBot();
    Object.assign(exports, lambdas);
    exports.handleOnfidoWebhookEvent = http_request_handler_1.createHandler(tradle);
    exports.models = productsAPI.models.all;
    exports.bot = productsAPI.bot;
    exports.db = productsAPI.bot.db;
    exports.tables = productsAPI.bot.db.tables;
    exports.productsAPI = productsAPI;
    exports.tradle = tradle;
}))();
//# sourceMappingURL=index.js.map