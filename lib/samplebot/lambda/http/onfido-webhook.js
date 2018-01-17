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
const lambda_1 = require("../../../lambda");
const cors = require("kcors");
const bot_1 = require("../../../bot");
const customize_1 = require("../../customize");
const noop_route_1 = require("../../../bot/middleware/noop-route");
const Errors = require("../../../errors");
const bot = bot_1.createBot({ ready: false });
const lambda = bot.createLambda({ source: lambda_1.EventSource.HTTP });
const promiseCustomize = customize_1.customize({ lambda, event: 'onfido:webhook' });
lambda.use(noop_route_1.post());
lambda.use(cors());
lambda.use((ctx) => __awaiter(this, void 0, void 0, function* () {
    const { onfidoPlugin } = yield promiseCustomize;
    if (!onfidoPlugin) {
        throw new Errors.HttpError(404, 'not found');
    }
    yield onfidoPlugin.processWebhookEvent({
        req: ctx.request.req
    });
}));
exports.handler = lambda.handler;
//# sourceMappingURL=onfido-webhook.js.map