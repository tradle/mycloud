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
const biz = require("@tradle/biz-plugins");
const deployment_models_1 = require("./deployment-models");
const bank_models_1 = require("./bank-models");
const deployment_handlers_1 = require("./deployment-handlers");
const sample_queries_1 = require("./sample-queries");
const createBot = require("../bot");
const strategies = require("./strategy");
const _1 = require("../");
const DEFAULT_CONF = require("./default-conf");
function createBotFromEnv(env) {
    const { PRODUCTS, ORG_DOMAIN, AUTO_VERIFY_FORMS, AUTO_APPROVE_APPS, AUTO_APPROVE_EMPLOYEES, GRAPHQL_AUTH, IS_LOCAL } = env;
    _1.tradle.env.set({
        PRODUCTS,
        ORG_DOMAIN,
        AUTO_VERIFY_FORMS,
        AUTO_APPROVE_APPS,
        AUTO_APPROVE_EMPLOYEES,
        GRAPHQL_AUTH,
        IS_LOCAL
    });
    const NAMESPACE = ORG_DOMAIN.split('.').reverse().join('.');
    const deploymentModels = deployment_models_1.default(NAMESPACE);
    const DEPLOYMENT = deploymentModels.deployment.id;
    const bankModels = bank_models_1.default(NAMESPACE);
    const models = Object.assign({}, deploymentModels.all, bankModels);
    const products = PRODUCTS.split(',').map(id => id.trim());
    const { bot, productsAPI, employeeManager, onfidoPlugin } = strategies.products({
        tradle: _1.tradle,
        namespace: NAMESPACE,
        models,
        products,
        approveAllEmployees: yn(AUTO_APPROVE_EMPLOYEES),
        autoVerify: yn(AUTO_VERIFY_FORMS),
        autoApprove: yn(AUTO_APPROVE_APPS),
        graphqlRequiresAuth: yn(GRAPHQL_AUTH)
    });
    const confBucket = bot.resources.buckets.PublicConf;
    const CONF_FILE = 'bot-conf.json';
    const putConf = (conf) => confBucket.put(CONF_FILE, conf);
    const cacheableConf = confBucket.getCacheable({
        key: CONF_FILE,
        ttl: 60000,
        parse: JSON.parse.bind(JSON)
    });
    const getConf = () => __awaiter(this, void 0, void 0, function* () {
        try {
            return yield cacheableConf.get();
        }
        catch (err) {
            return DEFAULT_CONF;
        }
    });
    const ensureConfStored = () => __awaiter(this, void 0, void 0, function* () {
        try {
            return yield cacheableConf.get();
        }
        catch (err) {
            return yield putConf(DEFAULT_CONF);
        }
    });
    const getPluginConf = (pluginName) => __awaiter(this, void 0, void 0, function* () {
        const conf = yield getConf();
        const { plugins = {} } = conf;
        return plugins[pluginName];
    });
    const customize = () => __awaiter(this, void 0, void 0, function* () {
        const customizeMessage = require('@tradle/plugin-customize-message');
        productsAPI.plugins.use(customizeMessage({
            get models() {
                return productsAPI.models.all;
            },
            getConf: () => getPluginConf('customize-message'),
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
    if (bot.graphqlAPI) {
        bot.graphqlAPI.setGraphiqlOptions({
            logo: {
                src: 'https://blog.tradle.io/content/images/2016/08/256x-no-text-1.png',
                width: 32,
                height: 32
            },
            bookmarks: {
                title: 'Samples',
                items: sample_queries_1.default
            }
        });
    }
    customize().then(() => bot.ready());
    const lambdas = createBot.lambdas(bot);
    return {
        tradle: _1.tradle,
        bot,
        lambdas,
        productsAPI,
        employeeManager,
        onfidoPlugin
    };
}
exports.default = createBotFromEnv;
//# sourceMappingURL=bot.js.map