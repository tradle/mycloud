"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) if (e.indexOf(p[i]) < 0)
            t[p[i]] = s[p[i]];
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const lambda_1 = require("../lambda");
exports.createLambda = (opts) => {
    const { bot } = opts, lambdaOpts = __rest(opts, ["bot"]);
    const lambda = new lambda_1.Lambda(lambdaOpts);
    lambda.bot = bot;
    if (!bot.isReady()) {
        const now = Date.now();
        const interval = setInterval(() => {
            const time = Date.now() - now;
            lambda.logger.warn(`${time}ms passed. Did you forget to call bot.ready()?`);
        }, 5000);
        interval.unref();
        bot.promiseReady().then(() => clearInterval(interval));
    }
    lambda.tasks.add({
        name: 'bot:ready',
        promiser: () => bot.promiseReady()
    });
    lambda.promiseReady = bot.promiseReady;
    return lambda;
};
//# sourceMappingURL=lambda.js.map