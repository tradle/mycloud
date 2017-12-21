"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const bot_1 = require("../../bot");
const fakeTradle = require("./tradle");
const fakeUsers = require("./users");
const promiseNoop = () => __awaiter(this, void 0, void 0, function* () { });
function fakeBot(opts = {}) {
    let { send = promiseNoop, objects = {}, identities = {}, messages = {}, } = opts;
    const tradle = opts.tradle || fakeTradle(opts);
    const models = {};
    const inputs = fakeBot.inputs({ models, tradle });
    inputs.users = fakeUsers({
        oncreate: user => bot.trigger('usercreate', user)
    });
    const bot = bot_1.createBot(inputs);
    return bot;
}
fakeBot.inputs = bot_1.createBot.inputs;
fakeBot.fromEngine = opts => fakeBot(fakeBot.inputs(opts));
module.exports = fakeBot;
//# sourceMappingURL=bot.js.map