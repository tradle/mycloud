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
const cors = require("cors");
const helmet = require("helmet");
const coexpress = require("co-express");
const createProductsStrategy = require("@tradle/bot-products");
const createEmployeeManager = require("@tradle/bot-employee-manager");
const bizPlugins = require("@tradle/biz-plugins");
const validateResource = require("@tradle/validate-resource");
const mergeModels = require("@tradle/merge-models");
const constants_1 = require("@tradle/constants");
const OnfidoAPI = require("@tradle/onfido-api");
const plugin_onfido_1 = require("@tradle/plugin-onfido");
const set_name_1 = require("./set-name");
const graphql_auth_1 = require("./graphql-auth");
const createBot = require("../../bot");
const commander_1 = require("./commander");
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
function createProductsBot(opts = {}) {
    const { tradle = defaultTradleInstance, models = baseModels, products = DEFAULT_PRODUCTS, namespace = 'test.bot', approveAllEmployees, autoVerify, autoApprove, graphqlRequiresAuth } = opts;
    const { ONFIDO_API_KEY } = process.env;
    const productsAPI = createProductsStrategy({
        namespace,
        models: {
            all: mergeModels()
                .add(baseModels)
                .add(models)
                .add(ONFIDO_API_KEY ? plugin_onfido_1.models.all : {})
                .get()
        },
        products
    });
    const employeeManager = createEmployeeManager({
        productsAPI,
        approveAll: approveAllEmployees,
        wrapForEmployee: true,
        shouldForwardFromEmployee: ({ req }) => !DONT_FORWARD_FROM_EMPLOYEE.includes(req.type)
    });
    const employeeModels = omit(productsAPI.models.all, BASE_MODELS_IDS);
    const customerModels = omit(productsAPI.models.all, Object.keys(productsAPI.models.private)
        .concat(BASE_MODELS_IDS));
    employeeModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification'];
    customerModels['tradle.OnfidoVerification'] = baseModels['tradle.OnfidoVerification'];
    const bot = createBot.fromEngine({
        tradle,
        models: productsAPI.models.all
    });
    productsAPI.install(bot);
    const commands = new commander_1.Commander({
        tradle,
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
    if (products.includes(`${namespace}.Deployment`)) {
        bot.logger.debug('attaching deployment handlers');
        productsAPI.plugins.use(require('./deployment-handlers'));
    }
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
            if (application && application.requestFor.endsWith('.Deployment')) {
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
    const onfidoPlugin = ONFIDO_API_KEY && createOnfidoPlugin({
        tradle,
        bot,
        productsAPI,
        token: ONFIDO_API_KEY
    });
    productsAPI.plugins.use(set_name_1.default({ bot, productsAPI }));
    if (graphqlRequiresAuth) {
        bot.graphqlAPI.setAuth(graphql_auth_1.createGraphQLAuth({
            tradle,
            bot,
            employeeManager
        }));
    }
    return {
        tradle,
        bot,
        productsAPI,
        employeeManager,
        onfidoPlugin,
        commands
    };
}
exports.default = createProductsBot;
const createOnfidoPlugin = ({ tradle, bot, productsAPI, token }) => {
    const onfidoAPI = new OnfidoAPI({ token });
    const onfidoPlugin = new plugin_onfido_1.Onfido({
        bot,
        logger: bot.env.sublogger('onfido'),
        products: [{
                product: 'tradle.OnfidoVerification',
                reports: onfidoAPI.mode === 'test'
                    ? ['document', 'identity']
                    : ['document', 'identity', 'facialsimilarity']
            }],
        productsAPI,
        onfidoAPI,
        padApplicantName: true,
        formsToRequestCorrectionsFor: ['tradle.OnfidoApplicant', 'tradle.Selfie']
    });
    (() => __awaiter(this, void 0, void 0, function* () {
        try {
            yield onfidoPlugin.getWebhook();
        }
        catch (err) {
            const url = `${tradle.resources.RestApi.ApiGateway}/onfido`;
            bot.logger.debug(`registering webhook for url: ${url}`);
            yield onfidoPlugin.registerWebhook({ url });
        }
    }))();
    productsAPI.plugins.use(onfidoPlugin);
    const { router } = tradle;
    router.use(cors());
    router.use(helmet());
    router.post('/onfido', coexpress(function* (req, res) {
        yield onfidoPlugin.processWebhookEvent({ req, res });
    }));
    router.use(tradle.router.defaultErrorHandler);
    return onfidoPlugin;
};
//# sourceMappingURL=products.js.map