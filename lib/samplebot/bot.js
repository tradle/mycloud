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
const dotProp = require("dot-prop");
const biz = require("@tradle/biz-plugins");
const customizeMessage = require("@tradle/plugin-customize-message");
const deployment_models_1 = require("./deployment-models");
const bank_models_1 = require("./bank-models");
const deployment_handlers_1 = require("./deployment-handlers");
const createBaseBot = require("../bot");
const strategies = require("./strategy");
const _1 = require("../");
const conf_1 = require("./conf");
function createBot(tradle = _1.createTradle()) {
    return __awaiter(this, void 0, void 0, function* () {
        const { IS_LOCAL } = tradle.env;
        const conf = conf_1.createConf({ tradle });
        let privateConf = yield conf.getPrivateConf();
        const { org } = privateConf;
        const products = privateConf.products.enabled;
        const namespace = org.domain.split('.').reverse().join('.');
        const deploymentModels = deployment_models_1.default(namespace);
        const DEPLOYMENT = deploymentModels.deployment.id;
        const bankModels = bank_models_1.default(namespace);
        const models = Object.assign({}, deploymentModels.all, bankModels);
        const { bot, productsAPI, employeeManager, onfidoPlugin } = strategies.products({
            conf,
            tradle,
            namespace,
            models,
            products,
            approveAllEmployees: products.approveAllEmployees,
            autoVerify: products.autoVerify,
            autoApprove: products.autoApprove,
        });
        const getPluginConf = (pluginName) => __awaiter(this, void 0, void 0, function* () {
            privateConf = yield conf.getPrivateConf();
            const { plugins = {} } = privateConf;
            return plugins[pluginName];
        });
        const customize = () => __awaiter(this, void 0, void 0, function* () {
            productsAPI.plugins.use(customizeMessage({
                get models() {
                    return productsAPI.models.all;
                },
                getConf: () => dotProp.get(privateConf, 'plugins.customize-message'),
                logger: bot.logger
            }));
            if (products.includes(DEPLOYMENT)) {
                productsAPI.plugins.use(deployment_handlers_1.default({ bot, deploymentModels }));
            }
            biz.forEach(plugin => productsAPI.plugins.use(plugin({
                bot,
                productsAPI,
                get models() {
                    return productsAPI.models.all;
                }
            }), true));
        });
        customize().then(() => bot.ready());
        const lambdas = createBaseBot.lambdas(bot);
        return {
            conf,
            tradle,
            bot,
            lambdas,
            productsAPI,
            employeeManager,
            onfidoPlugin
        };
    });
}
exports.createBot = createBot;
//# sourceMappingURL=bot.js.map