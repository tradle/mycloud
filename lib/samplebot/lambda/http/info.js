"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const coexpress = require("co-express");
const cors = require("cors");
const helmet = require("helmet");
const bot_1 = require("../../../bot");
const configure_1 = require("../../configure");
const bot = bot_1.createBot();
const { router } = bot;
const conf = configure_1.createConf(bot);
const infoRouter = express.Router();
infoRouter.use(cors());
infoRouter.use(helmet());
infoRouter.get('/', coexpress(function* (req, res) {
    const result = yield conf.getPublicConf();
    result.aws = true;
    result.iotParentTopic = bot.env.IOT_PARENT_TOPIC;
    res.json(result);
}));
infoRouter.use(router.defaultErrorHandler);
router.use('/info', infoRouter);
exports.handler = bot.createHttpHandler();
//# sourceMappingURL=info.js.map