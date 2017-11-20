"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = require("../../");
const bot_1 = require("../bot");
const tradle = _1.createTradle();
const promiseBot = bot_1.createBot(tradle);
exports.promiseBot = promiseBot;
const handler = tradle.wrap(function* (...args) {
    const { lambdas } = yield promiseBot;
    yield lambdas.onmessage(...args);
});
exports.handler = handler;
//# sourceMappingURL=onmessage.js.map