"use strict";
const bot_1 = require("../../../bot");
const customize_1 = require("../../customize");
const bot = bot_1.createBot({ ready: false });
const lambda = bot.lambdas.onmessage();
customize_1.customize({ bot, event: 'message' });
const { handler } = lambda;
module.exports = lambda;
//# sourceMappingURL=onmessage.js.map