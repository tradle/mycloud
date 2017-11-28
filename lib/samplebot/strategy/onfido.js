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
exports.createOnfidoPlugin = ({ bot, productsAPI, apiKey }) => {
    const onfidoAPI = new OnfidoAPI({ token: apiKey });
    const logger = bot.logger.sub('onfido');
    const onfidoPlugin = new plugin_onfido_1.Onfido({
        bot,
        logger,
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
            const { apiGateway } = bot.resources;
            if (/^https?:\/\/localhost/.test(apiGateway)) {
                logger.warn(`can't register webhook for localhost. ` +
                    `Run: ngrok http ${bot.env.SERVERLESS_OFFLINE_PORT} ` +
                    `and set the SERVERLESS_OFFLINE_APIGW environment variable`);
                return;
            }
            const url = `${bot.apiBaseUrl}/onfido`;
            logger.info(`registering webhook for url: ${url}`);
            yield onfidoPlugin.registerWebhook({ url });
        }
    }))();
    productsAPI.plugins.use(onfidoPlugin);
    return onfidoPlugin;
};
//# sourceMappingURL=onfido.js.map