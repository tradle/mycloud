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
const shallowClone = require("xtend");
const yn = require("yn");
const sample_queries_1 = require("./sample-queries");
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
let { PRODUCTS, ORG_DOMAIN = 'tradle.io', AUTO_VERIFY_FORMS, AUTO_APPROVE_APPS, AUTO_APPROVE_EMPLOYEES = true, GRAPHQL_AUTH } = process.env;
const NAMESPACE = ORG_DOMAIN.split('.').reverse().join('.');
const DEPLOYMENT = `${NAMESPACE}.Deployment`;
const deploymentModels = require('./deployment-models')(NAMESPACE);
const bankModels = require('./bank-models')(NAMESPACE);
const models = shallowClone(deploymentModels, bankModels);
const products = PRODUCTS.split(',').map(id => id.trim());
const createBot = require('../bot');
const strategies = require('./strategy');
const { bot, productsAPI, employeeManager, onfidoPlugin } = strategies.products({
    namespace: NAMESPACE,
    models,
    products,
    approveAllEmployees: yn(AUTO_APPROVE_EMPLOYEES),
    autoVerify: yn(AUTO_VERIFY_FORMS),
    autoApprove: yn(AUTO_APPROVE_APPS),
    graphqlRequiresAuth: yn(GRAPHQL_AUTH)
});
if (bot.graphqlAPI) {
    bot.graphqlAPI.setGraphiqlOptions({
        logo: {
            src: 'https://blog.tradle.io/content/images/2016/08/256x-no-text-1.png',
            width: 32,
            height: 32
        },
        bookmarks: [
            {
                title: 'Photo ID list',
                query: sample_queries_1.listPhotoIds
            },
            {
                title: 'Application list',
                query: sample_queries_1.listApplications
            },
            {
                title: 'Name forms list',
                query: sample_queries_1.listNames
            }
        ]
    });
}
bot.hook('message', ({ user, type }) => __awaiter(this, void 0, void 0, function* () {
    debug(`received ${type}`);
    if (type === 'tradle.Ping') {
        yield bot.send({
            to: user.id,
            object: {
                [TYPE]: 'tradle.Pong'
            }
        });
        return false;
    }
}), true);
const cacheableConf = bot.resources.buckets.PublicConf.getCacheable({
    key: 'bot-conf.json',
    ttl: 60000,
    parse: JSON.parse.bind(JSON)
});
const getConf = () => __awaiter(this, void 0, void 0, function* () {
    return require('./default-conf');
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
        productsAPI.plugins.use(require('./deployment-handlers'));
    }
});
customize().then(() => bot.ready());
exports = module.exports = createBot.lambdas(bot);
exports.handleOnfidoWebhookEvent = require('../lambda/http/default').handler;
exports.models = productsAPI.models.all;
exports.bot = productsAPI.bot;
exports.db = productsAPI.bot.db;
exports.tables = productsAPI.bot.db.tables;
exports.productsAPI = productsAPI;
//# sourceMappingURL=index.js.map