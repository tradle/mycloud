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
const crypto = require("crypto");
const omit = require("object.omit");
const createProductsStrategy = require("@tradle/bot-products");
const createEmployeeManager = require("@tradle/bot-employee-manager");
const bizPlugins = require("@tradle/biz-plugins");
const validateResource = require("@tradle/validate-resource");
const mergeModels = require("@tradle/merge-models");
const constants_1 = require("@tradle/constants");
const plugin_onfido_1 = require("@tradle/plugin-onfido");
const customizeMessage = require("@tradle/plugin-customize-message");
const set_name_1 = require("./set-name");
const graphql_auth_1 = require("./graphql-auth");
const commander_1 = require("./commander");
const deployment_models_1 = require("../deployment-models");
const bank_models_1 = require("../bank-models");
const deployment_handlers_1 = require("../deployment-handlers");
const onfido_1 = require("./onfido");
const debug = require('debug')('tradle:sls:products');
const { parseStub } = validateResource.utils;
const baseModels = require('../../models');
const BASE_MODELS_IDS = Object.keys(baseModels);
const DEFAULT_PRODUCTS = ['tradle.CurrentAccount'];
const DONT_FORWARD_FROM_EMPLOYEE = [
    'tradle.Verification',
    'tradle.ApplicationApproval',
    'tradle.ApplicationDenial',
    'tradle.AssignRelationshipManager'
];
const USE_ONFIDO = false;
function createProductsBot({ bot, conf }) {
    const { domain } = conf.org;
    const { enabled, plugins = {}, autoApprove, autoVerify, approveAllEmployees, graphqlRequiresAuth } = conf.products;
    const { onfido = {} } = plugins;
    const namespace = domain.split('.').reverse().join('.');
    const deploymentModels = deployment_models_1.default(namespace);
    const DEPLOYMENT = deploymentModels.deployment.id;
    const bankModels = bank_models_1.default(namespace);
    const models = Object.assign({}, deploymentModels.all, bankModels);
    const onfidoApiKey = USE_ONFIDO && onfido.apiKey;
    const productsAPI = createProductsStrategy({
        namespace,
        models: {
            all: mergeModels()
                .add(baseModels)
                .add(models)
                .add(onfidoApiKey ? plugin_onfido_1.models.all : {})
                .get()
        },
        products: enabled,
    });
    const employeeManager = createEmployeeManager({
        productsAPI,
        approveAll: approveAllEmployees,
        wrapForEmployee: true,
        shouldForwardFromEmployee: ({ req }) => !DONT_FORWARD_FROM_EMPLOYEE.includes(req.type)
    });
    const employeeModels = omit(productsAPI.models.all, BASE_MODELS_IDS);
    const customerModels = omit(productsAPI.models.all, Object.keys(productsAPI.models.private.all)
        .concat(BASE_MODELS_IDS));
    employeeModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification'];
    customerModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification'];
    bot.setCustomModels(productsAPI.models.all);
    productsAPI.install(bot);
    const commands = new commander_1.Commander({
        conf,
        bot,
        productsAPI,
        employeeManager
    });
    productsAPI.removeDefaultHandler('onCommand');
    const keepModelsFresh = createProductsStrategy.keepModelsFresh({
        getIdentifier: req => {
            const { user, message } = req;
            const { originalSender } = message;
            let id = user.id;
            if (originalSender) {
                id += ':' + originalSender;
            }
            return employeeManager.isEmployee(user) ? 'e:' + id : id;
        },
        getModelsForUser: user => {
            if (employeeManager.isEmployee(user)) {
                return employeeModels;
            }
            return customerModels;
        },
        send: (...args) => productsAPI.send(...args)
    });
    bizPlugins.forEach(plugin => productsAPI.plugins.use(plugin({
        bot,
        get models() {
            return productsAPI.models.all;
        },
        productsAPI
    }), true));
    productsAPI.plugins.use({ onmessage: keepModelsFresh }, true);
    productsAPI.plugins.use({
        'onmessage:tradle.Form': (req) => __awaiter(this, void 0, void 0, function* () {
            let { type, application } = req;
            if (type === 'tradle.ProductRequest') {
                debug(`deferring to default handler for ${type}`);
                return;
            }
            if (!autoVerify) {
                debug(`not auto-verifying ${type}`);
                return;
            }
            if (application && application.requestFor === DEPLOYMENT) {
                debug(`not autoverifying MyCloud config form: ${type}`);
                return;
            }
            if (!application) {
                debug(`not auto-verifying ${type} (unknown application)`);
                return;
            }
            debug(`auto-verifying ${type}`);
            yield productsAPI.verify({
                req,
                application,
                send: true,
                verification: {
                    [constants_1.TYPE]: 'tradle.Verification',
                    method: {
                        aspect: 'validity',
                        reference: [{
                                queryId: crypto.randomBytes(8).toString('hex')
                            }],
                        [constants_1.TYPE]: 'tradle.APIBasedVerificationMethod',
                        api: {
                            [constants_1.TYPE]: 'tradle.API',
                            name: 'tradle-internal'
                        }
                    }
                }
            });
        }),
        'onmessage:tradle.SimpleMessage': (req) => __awaiter(this, void 0, void 0, function* () {
            const { application, object } = req;
            const { message } = object;
            bot.debug(`processing simple message: ${message}`);
            if (message[0] === '/')
                return;
            if (application && application.relationshipManager)
                return;
            const lowercase = message.toLowerCase();
            if (/^hey|hi|hello$/.test(message)) {
                yield productsAPI.send({
                    req,
                    object: {
                        [constants_1.TYPE]: 'tradle.SimpleMessage',
                        message: `${message} yourself!`
                    }
                });
            }
        }),
        onFormsCollected: (req) => __awaiter(this, void 0, void 0, function* () {
            if (!autoApprove)
                return;
            const { user, application } = req;
            const approved = productsAPI.state.hasApplication({
                applications: user.applicationsApproved || [],
                application
            });
            if (!approved) {
                yield productsAPI.approveApplication({ req });
            }
        }),
        onCommand: ({ req, command }) => __awaiter(this, void 0, void 0, function* () {
            yield commands.exec({ req, command });
        })
    });
    if (productsAPI.products.includes(DEPLOYMENT)) {
        productsAPI.plugins.use(deployment_handlers_1.default({ bot, deploymentModels }));
    }
    const onfidoPlugin = onfidoApiKey && onfido_1.createOnfidoPlugin({
        bot,
        productsAPI,
        apiKey: onfido.apiKey
    });
    productsAPI.plugins.use(set_name_1.default({ bot, productsAPI }));
    if (bot.hasGraphqlAPI() && graphqlRequiresAuth) {
        bot.getGraphqlAPI().setAuth(graphql_auth_1.createGraphQLAuth({ bot, employeeManager }));
    }
    const customizeMessageOpts = plugins['customize-message'];
    if (customizeMessageOpts) {
        productsAPI.plugins.use(customizeMessage({
            models: productsAPI.models.all,
            conf: customizeMessageOpts,
            logger: bot.logger
        }));
    }
    return {
        bot,
        productsAPI,
        employeeManager,
        onfidoPlugin,
        commands
    };
}
exports.default = createProductsBot;
//# sourceMappingURL=index.js.map