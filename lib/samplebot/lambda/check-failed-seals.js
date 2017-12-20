"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bot_1 = require("../../bot");
const bot = bot_1.createBot();
const lambda = bot.lambdas.checkFailedSeals();
exports.handler = lambda.handler;
//# sourceMappingURL=check-failed-seals.js.map