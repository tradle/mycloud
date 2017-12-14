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
const bot_1 = require("../../bot");
const bot = bot_1.createBot();
const lambda = bot.createLambda();
lambda.use(({ event }) => __awaiter(this, void 0, void 0, function* () {
    const { link } = event;
    lambda.logger.debug('adding contact', link);
    return bot.identities.addContact({ link });
}));
exports.handler = lambda.handler;
//# sourceMappingURL=add-contact.js.map