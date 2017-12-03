"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
require("../../init-lambda");
const bot_1 = require("../../bot");
const configure_1 = require("../configure");
const bot = bot_1.createBot();
bot.ready();
const conf = configure_1.createConf(bot);
exports.handler = bot.createHandler((event) => __awaiter(this, void 0, void 0, function* () {
    yield conf.setStyle(event);
}), { source: 'lambda' });
//# sourceMappingURL=set-style.js.map