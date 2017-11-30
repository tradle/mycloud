"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const bot = require('../bot').createBot();
exports.handler = bot.createHandler(function* (event, context) {
    yield bot.send(event);
});
//# sourceMappingURL=send.js.map