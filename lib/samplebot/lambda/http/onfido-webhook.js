"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const coexpress = require("co-express");
const cors = require("cors");
const helmet = require("helmet");
const bot_1 = require("../../../bot");
const customize_1 = require("../../customize");
const bot = bot_1.createBot();
const promiseCustom = customize_1.customize({ bot });
const onfidoRouter = express.Router();
onfidoRouter.use(cors());
onfidoRouter.use(helmet());
onfidoRouter.get('/', coexpress(function* (req, res) {
    const { onfidoPlugin } = yield promiseCustom;
    yield onfidoPlugin.processWebhookEvent({ req, res });
}));
const { router } = bot;
onfidoRouter.use(router.defaultErrorHandler);
router.use('/onfido', onfidoRouter);
exports.handler = bot.createHttpHandler();
//# sourceMappingURL=onfido-webhook.js.map