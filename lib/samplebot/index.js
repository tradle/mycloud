"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const yn = require("yn");
const bot_1 = require("./bot");
const default_1 = require("../lambda/http/default");
const { IS_LAMBDA_ENVIRONMENT, NODE_ENV } = process.env;
if (NODE_ENV === 'test') {
    Object.assign(process.env, require('../test/service-map'), Object.assign({}, process.env));
}
if (yn(IS_LAMBDA_ENVIRONMENT) === false) {
    const { env } = require('../cli/serverless-yml').custom.brand;
    Object.assign(process.env, env);
}
const debug = require('debug')('λ:samplebot');
const TYPE = '_t';
const { bot, tradle, lambdas, productsAPI, employeeManager, onfidoPlugin } = bot_1.default(Object.assign({ ORG_DOMAIN: 'tradle.io', AUTO_APPROVE_EMPLOYEES: true }, process.env));
exports = module.exports = lambdas;
exports.handleOnfidoWebhookEvent = default_1.handler;
exports.models = productsAPI.models.all;
exports.bot = productsAPI.bot;
exports.db = productsAPI.bot.db;
exports.tables = productsAPI.bot.db.tables;
exports.productsAPI = productsAPI;
exports.tradle = tradle;
//# sourceMappingURL=index.js.map