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
const biz = require("@tradle/biz-plugins");
const customizeMessage = require("@tradle/plugin-customize-message");
const deployment_models_1 = require("./deployment-models");
const bank_models_1 = require("./bank-models");
const deployment_handlers_1 = require("./deployment-handlers");
const strategies = require("./strategy");
const bot_1 = require("../bot");
const configure_1 = require("./configure");
function customize(opts = {}) {
    return __awaiter(this, void 0, void 0, function* () {
        const { bot = bot_1.createBot(), delayReady } = opts;
        const conf = configure_1.createConf(bot);
        let privateConf = yield conf.getPrivateConf();
        const { org, products } = privateConf;
        const { plugins = {} } = products;
        const { onfido = {} } = plugins;
        const namespace = org.domain.split('.').reverse().join('.');
        const deploymentModels = deployment_models_1.default(namespace);
        const DEPLOYMENT = deploymentModels.deployment.id;
        const bankModels = bank_models_1.default(namespace);
        const models = Object.assign({}, deploymentModels.all, bankModels);
        const { productsAPI, employeeManager, onfidoPlugin } = strategies.products({
            conf,
            onfido,
            bot,
            namespace,
            models,
            products: products.enabled,
            approveAllEmployees: products.approveAllEmployees,
            autoVerify: products.autoVerify,
            autoApprove: products.autoApprove,
            queueSends: bot.env.TESTING ? true : products.queueSends
        });
        const getPluginConf = (pluginName) => __awaiter(this, void 0, void 0, function* () {
            privateConf = yield conf.getPrivateConf();
            const { plugins = {} } = privateConf;
            return plugins[pluginName];
        });
        productsAPI.plugins.use(customizeMessage({
            get models() {
                return productsAPI.models.all;
            },
            getConf: () => getPluginConf('customize-message'),
            logger: bot.logger
        }));
        if (productsAPI.products.includes(DEPLOYMENT)) {
            productsAPI.plugins.use(deployment_handlers_1.default({ bot, deploymentModels }));
        }
        biz.forEach(plugin => productsAPI.plugins.use(plugin({
            bot,
            productsAPI,
            get models() {
                return productsAPI.models.all;
            }
        }), true));
        if (!opts.delayReady)
            bot.ready();
        return {
            conf,
            bot,
            productsAPI,
            employeeManager,
            onfidoPlugin
        };
    });
}
exports.customize = customize;
//# sourceMappingURL=customize.js.map