"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bot_1 = require("../../../bot");
const customize_1 = require("../../customize");
const bot = bot_1.createBot({ ready: false });
const lambda = bot.lambdas.inbox();
customize_1.customize({ lambda, event: 'message' });
exports.handler = lambda.handler;
//# sourceMappingURL=inbox.js.map