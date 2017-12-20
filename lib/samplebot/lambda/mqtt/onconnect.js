"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bot_1 = require("../../../bot");
const bot = bot_1.createBot();
const lambda = bot.lambdas.onconnect();
exports.handler = lambda.handler;
//# sourceMappingURL=onconnect.js.map