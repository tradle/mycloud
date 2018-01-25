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
const OnfidoAPI = require("@tradle/onfido-api");
const plugin_onfido_1 = require("@tradle/plugin-onfido");
const Errors = require("../errors");
exports.createPlugin = ({ bot, logger, productsAPI, apiKey }) => {
    const onfidoAPI = new OnfidoAPI({ token: apiKey });
    const onfidoPlugin = new plugin_onfido_1.Onfido({
        bot,
        logger,
        products: [{
                product: 'tradle.onfido.CustomerVerification',
                reports: onfidoAPI.mode === 'test'
                    ? ['document', 'identity']
                    : ['document', 'identity', 'facialsimilarity']
            }],
        productsAPI,
        onfidoAPI,
        padApplicantName: true,
        formsToRequestCorrectionsFor: ['tradle.onfido.Applicant', 'tradle.Selfie']
    });
    productsAPI.plugins.use(onfidoPlugin);
    return onfidoPlugin;
};
exports.registerWebhook = ({ bot, onfidoPlugin }) => __awaiter(this, void 0, void 0, function* () {
    const ret = {
        created: false,
        webhook: null
    };
    if (bot.isTesting ||
        /^https?:\/\/localhost/.test(bot.apiBaseUrl)) {
        onfidoPlugin.logger.warn(`can't register webhook for localhost. ` +
            `Run: ngrok http ${bot.env.SERVERLESS_OFFLINE_PORT} ` +
            `and set the SERVERLESS_OFFLINE_APIGW environment variable`);
        return ret;
    }
    const url = `${bot.apiBaseUrl}/onfido`;
    try {
        const webhook = yield onfidoPlugin.getWebhook();
        if (webhook.url === url) {
            ret.webhook = webhook;
            return ret;
        }
        yield onfidoPlugin.unregisterWebhook({ url: webhook.url });
    }
    catch (err) {
        Errors.rethrow(err, 'system');
    }
    onfidoPlugin.logger.info(`registering webhook for url: ${url}`);
    ret.webhook = yield onfidoPlugin.registerWebhook({ url });
    ret.created = true;
    return ret;
});
//# sourceMappingURL=onfido.js.map