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
const lambda_1 = require("../../lambda");
const configure_1 = require("../configure");
const bot_1 = require("../../bot");
const bot = bot_1.createBot();
const lambda = bot.createLambda({ source: lambda_1.EventSource.LAMBDA });
const conf = configure_1.createConf({ bot });
lambda.use((ctx) => __awaiter(this, void 0, void 0, function* () {
    const { style, bot, modelsPack, terms } = ctx.event;
    yield conf.update({ style, bot, modelsPack, terms });
    yield conf.forceReinitializeContainers();
}));
exports.handler = lambda.handler;
//# sourceMappingURL=set-conf.js.map