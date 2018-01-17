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
const bot_1 = require("../../bot");
const lambda_1 = require("../../bot/lambda");
const customize_1 = require("../customize");
const onfido_1 = require("../strategy/onfido");
const bot = bot_1.createBot({ ready: false });
const lambda = lambda_1.fromCli({ bot });
const promiseComponents = customize_1.customize({ lambda, event: 'onfido:register_webhook', });
lambda.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
    const { conf, onfidoPlugin } = yield promiseComponents;
    if (!onfidoPlugin) {
        throw new Error('onfido plugin not enabled');
    }
    ctx.body = yield onfido_1.registerWebhook({ bot, onfidoPlugin });
}));
exports.handler = lambda.handler;
//# sourceMappingURL=onfido-register.js.map