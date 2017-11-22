"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const customize_1 = require("./customize");
const bot_1 = require("../bot");
const bot = bot_1.createBot();
Object.assign(exports, bot.lambdas);
exports.promiseCustomized = customize_1.customize({ bot });
//# sourceMappingURL=index.js.map