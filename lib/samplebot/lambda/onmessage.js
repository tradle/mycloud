"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bot_1 = require("../../bot");
const customize_1 = require("../customize");
const bot = bot_1.createBot();
const lambda = bot.lambdas.onmessage();
customize_1.customize({ bot, event: 'message' });
const { handler } = lambda;
module.exports = lambda;
//# sourceMappingURL=onmessage.js.map