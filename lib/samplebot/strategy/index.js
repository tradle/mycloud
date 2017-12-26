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
const createProductsStrategy = require("@tradle/bot-products");
const createEmployeeManager = require("@tradle/bot-employee-manager");
const validateResource = require("@tradle/validate-resource");
const mergeModels = require("@tradle/merge-models");
const constants_1 = require("@tradle/constants");
const plugin_onfido_1 = require("@tradle/plugin-onfido");
const set_name_1 = require("./set-name");
const keep_fresh_1 = require("./keep-fresh");
const keep_models_fresh_1 = require("./keep-models-fresh");
const deployment_models_1 = require("../deployment-models");
const bank_models_1 = require("../bank-models");
const TermsAndConditions = require("./ts-and-cs");
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
const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding';
const USE_ONFIDO = true;
const willHandleMessages = event => event === 'message';
function createProductsBot({ bot, logger, namespace, conf, termsAndConditions, customModels, style, event }) {
    const { enabled, plugins = {}, autoApprove, approveAllEmployees, graphqlRequiresAuth } = conf.products;
    logger.debug('setting up products strategy');
    const deploymentModels = deployment_models_1.default(namespace);
    const DEPLOYMENT = deploymentModels.deployment.id;
    const bankModels = bank_models_1.default(namespace);
    const models = Object.assign({}, deploymentModels.all, bankModels);
    const handleMessages = willHandleMessages(event);
    const mergeModelsOpts = { validate: bot.isTesting };
    const productsAPI = createProductsStrategy({
        namespace,
        models: {
            all: mergeModels()
                .add(baseModels, { validate: false })
                .add(models, mergeModelsOpts)
                .add(USE_ONFIDO ? plugin_onfido_1.models.all : {}, mergeModelsOpts)
                .add(customModels || {}, mergeModelsOpts)
                .get()
        },
        products: enabled,
        validateModels: bot.isTesting
    });
    const send = (...args) => productsAPI.send(...args);
    const employeeManager = createEmployeeManager({
        productsAPI,
        approveAll: approveAllEmployees,
        wrapForEmployee: true,
        shouldForwardFromEmployee: ({ req }) => !DONT_FORWARD_FROM_EMPLOYEE.includes(req.type),
        handleMessages
    });
    bot.setCustomModels(productsAPI.models.all);
    if (handleMessages) {
        productsAPI.install(bot);
    }
    else {
        productsAPI.bot = bot;
        productsAPI.emit('bot', bot);
    }
    let commands;
    if (handleMessages) {
        const { Commander } = require('./commander');
        commands = new Commander({
            conf,
            bot,
            productsAPI,
            employeeManager
        });
        productsAPI.removeDefaultHandler('onCommand');
        if (style) {
            const keepStylesFresh = keep_fresh_1.keepFreshPlugin({
                object: style,
                propertyName: 'stylesHash',
                send
            });
            productsAPI.plugins.use({ onmessage: keepStylesFresh }, true);
        }
        const getModelsForUser = keep_models_fresh_1.createGetModelsForUser({ productsAPI, employeeManager });
        const keepModelsFresh = keep_models_fresh_1.keepModelsFreshPlugin({
            getIdentifier: keep_models_fresh_1.createGetIdentifierFromReq({ employeeManager }),
            getModelsForUser,
            send
        });
        const bizPlugins = require('@tradle/biz-plugins');
        bizPlugins.forEach(plugin => productsAPI.plugins.use(plugin({
            bot,
            get models() {
                return productsAPI.models.all;
            },
            productsAPI
        }), true));
        if (termsAndConditions) {
            const tcPlugin = TermsAndConditions.createPlugin({
                termsAndConditions,
                productsAPI,
                logger
            });
            productsAPI.plugins.use(tcPlugin, true);
        }
        productsAPI.plugins.use({ onmessage: keepModelsFresh }, true);
        productsAPI.plugins.use({
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
                    yield send({
                        req,
                        object: {
                            [constants_1.TYPE]: 'tradle.SimpleMessage',
                            message: `${message} yourself!`
                        }
                    });
                }
            }),
            onFormsCollected: (req) => __awaiter(this, void 0, void 0, function* () {
                const { user, application } = req;
                if (!autoApprove) {
                    const goodToGo = productsAPI.haveAllSubmittedFormsBeenVerified({ application });
                    if (!goodToGo)
                        return;
                }
                const approved = productsAPI.state.hasApplication({
                    applications: user.applicationsApproved || [],
                    application
                });
                if (!approved) {
                    yield productsAPI.approveApplication({ req });
                    yield productsAPI.issueVerifications({ req, user, application, send: true });
                }
            }),
            onCommand: ({ req, command }) => __awaiter(this, void 0, void 0, function* () {
                yield commands.exec({ req, command });
            }),
            didApproveApplication: ({ req }) => __awaiter(this, void 0, void 0, function* () {
                const { application, user } = req;
                if (application.requestFor === EMPLOYEE_ONBOARDING) {
                    yield keep_models_fresh_1.sendModelsPackIfUpdated({
                        user,
                        models: getModelsForUser(user),
                        send: object => send({ req, object })
                    });
                }
            })
        });
        if (productsAPI.products.includes(DEPLOYMENT)) {
            const { createDeploymentHandlers } = require('../deployment-handlers');
            productsAPI.plugins.use(createDeploymentHandlers({ bot, deploymentModels }));
        }
        productsAPI.plugins.use(set_name_1.setNamePlugin({ bot, productsAPI }));
    }
    let onfidoPlugin;
    const { onfido = {} } = plugins;
    if (USE_ONFIDO && onfido.apiKey) {
        const { createOnfidoPlugin } = require('./onfido');
        onfidoPlugin = createOnfidoPlugin({
            bot,
            productsAPI,
            apiKey: onfido.apiKey
        });
    }
    const customizeMessageOpts = plugins['customize-message'];
    if (customizeMessageOpts) {
        const customizeMessage = require('@tradle/plugin-customize-message');
        productsAPI.plugins.use(customizeMessage({
            models: productsAPI.models.all,
            conf: customizeMessageOpts,
            logger
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