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
const set_name_1 = require("./plugins/set-name");
const keep_fresh_1 = require("./plugins/keep-fresh");
const prefill_form_1 = require("./plugins/prefill-form");
const set_lens_1 = require("./plugins/set-lens");
const keep_models_fresh_1 = require("./plugins/keep-models-fresh");
const TermsAndConditions = require("./plugins/ts-and-cs");
const baseModels = require("../models");
const debug = require('debug')('tradle:sls:products');
const { parseStub } = validateResource.utils;
const BASE_MODELS_IDS = Object.keys(baseModels);
const DEFAULT_PRODUCTS = ['tradle.CurrentAccount'];
const DONT_FORWARD_FROM_EMPLOYEE = [
    'tradle.Verification',
    'tradle.ApplicationApproval',
    'tradle.ApplicationDenial',
    'tradle.AssignRelationshipManager'
];
const EMPLOYEE_ONBOARDING = 'tradle.EmployeeOnboarding';
const ONFIDO_ENABLED = true;
const willHandleMessages = event => event === 'message';
function createProductsBot({ bot, logger, conf, event }) {
    const { enabled, plugins = {}, autoApprove, approveAllEmployees, graphqlRequiresAuth } = conf.bot.products;
    logger.debug('setting up products strategy');
    const handleMessages = willHandleMessages(event);
    const mergeModelsOpts = { validate: bot.isTesting };
    const productsAPI = createProductsStrategy({
        logger: logger.sub('products'),
        bot,
        models: {
            all: mergeModels()
                .add(baseModels, { validate: false })
                .add(conf.modelsPack ? conf.modelsPack.models : {}, mergeModelsOpts)
                .get()
        },
        products: enabled,
        validateModels: bot.isTesting
    });
    const send = (opts) => productsAPI.send(opts);
    const employeeManager = createEmployeeManager({
        logger: logger.sub('employees'),
        bot,
        productsAPI,
        approveAll: approveAllEmployees,
        wrapForEmployee: true,
        shouldForwardFromEmployee: ({ req }) => !DONT_FORWARD_FROM_EMPLOYEE.includes(req.type),
        handleMessages
    });
    if (handleMessages) {
        bot.hook('message', productsAPI.onmessage);
    }
    const myIdentityPromise = bot.getMyIdentity();
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
        const getModelsPackForUser = keep_models_fresh_1.createModelsPackGetter({ bot, productsAPI, employeeManager });
        const keepModelsFresh = keep_models_fresh_1.keepModelsFreshPlugin({
            getIdentifier: keep_models_fresh_1.createGetIdentifierFromReq({ employeeManager }),
            getModelsPackForUser,
            send
        });
        const bizPlugins = require('@tradle/biz-plugins');
        bizPlugins.forEach(plugin => productsAPI.plugins.use(plugin({
            bot,
            get models() {
                return bot.modelStore.models;
            },
            productsAPI
        }), true));
        if (conf.termsAndConditions) {
            const tcPlugin = TermsAndConditions.createPlugin({
                termsAndConditions: conf.termsAndConditions,
                productsAPI,
                employeeManager,
                logger
            });
            productsAPI.plugins.use(tcPlugin, true);
        }
        if (conf.style) {
            const keepStylesFresh = keep_fresh_1.keepFreshPlugin({
                object: conf.style,
                propertyName: 'stylesHash',
                send
            });
            productsAPI.plugins.use({ onmessage: keepStylesFresh }, true);
        }
        productsAPI.plugins.use({ onmessage: keepModelsFresh }, true);
        productsAPI.plugins.use({
            'onmessage:tradle.SimpleMessage': (req) => __awaiter(this, void 0, void 0, function* () {
                const { user, application, object } = req;
                const { message } = object;
                bot.debug(`processing simple message: ${message}`);
                if (message[0] === '/')
                    return;
                if (application &&
                    application.relationshipManagers &&
                    application.relationshipManagers.length)
                    return;
                const lowercase = message.toLowerCase();
                if (/^hey|hi|hello$/.test(message)) {
                    yield send({
                        req,
                        to: user,
                        object: {
                            [constants_1.TYPE]: 'tradle.SimpleMessage',
                            message: `${message} yourself!`
                        }
                    });
                }
            }),
            onFormsCollected: ({ req, user, application }) => __awaiter(this, void 0, void 0, function* () {
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
                    yield productsAPI.approveApplication({ req, user, application });
                    yield productsAPI.issueVerifications({
                        req, user, application, send: true
                    });
                }
            }),
            onCommand: ({ req, command }) => __awaiter(this, void 0, void 0, function* () {
                yield commands.exec({ req, command });
            }),
            didApproveApplication: ({ req, user, application, judge }) => __awaiter(this, void 0, void 0, function* () {
                if (judge) {
                    yield productsAPI.issueVerifications({ req, user, application, send: true });
                }
                if (application.requestFor === EMPLOYEE_ONBOARDING) {
                    const modelsPack = yield getModelsPackForUser(user);
                    if (modelsPack) {
                        yield keep_models_fresh_1.sendModelsPackIfUpdated({
                            user,
                            modelsPack,
                            send: object => send({ req, to: user, application, object })
                        });
                    }
                }
            })
        });
        if (productsAPI.products.includes('tradle.deploy.Deployment')) {
            const { createDeploymentHandlers } = require('../deployment-handlers');
            productsAPI.plugins.use(createDeploymentHandlers({ bot }));
        }
        productsAPI.plugins.use(set_name_1.setNamePlugin({ bot, productsAPI }));
    }
    let onfidoPlugin;
    const { onfido = {} } = plugins;
    const willUseOnfido = ONFIDO_ENABLED &&
        onfido.apiKey &&
        (handleMessages || /onfido/.test(event));
    if (willUseOnfido) {
        const { createPlugin, registerWebhook } = require('./onfido');
        onfidoPlugin = createPlugin({
            bot,
            logger: logger.sub('onfido'),
            productsAPI,
            apiKey: onfido.apiKey
        });
    }
    const customizeMessageOpts = plugins['customize-message'];
    if (customizeMessageOpts) {
        const customizeMessage = require('@tradle/plugin-customize-message');
        productsAPI.plugins.use(customizeMessage({
            get models() {
                return bot.modelStore.models;
            },
            conf: customizeMessageOpts,
            logger
        }));
    }
    if (plugins['prefill-form']) {
        productsAPI.plugins.use(prefill_form_1.createPlugin({
            conf: plugins['prefill-form'],
            logger: logger.sub('plugin-prefill-form')
        }));
    }
    if (plugins['lens']) {
        productsAPI.plugins.use(set_lens_1.createPlugin({
            conf: plugins['lens'],
            logger: logger.sub('plugin-lens')
        }));
    }
    return {
        bot,
        productsAPI,
        employeeManager,
        onfidoPlugin,
        commands,
        models: bot.modelStore.models
    };
}
exports.default = createProductsBot;
exports.createProductsBot = createProductsBot;
//# sourceMappingURL=index.js.map