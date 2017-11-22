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
const init_1 = require("../init");
const bot = bot_1.createBot();
exports.handler = bot.oninit(({ type, payload }) => __awaiter(this, void 0, void 0, function* () {
    const init = new init_1.Init({
        bot,
        conf: payload
    });
    if (type === 'init') {
        yield init.init();
    }
    else if (type === 'update') {
        yield init.update();
    }
}));
//# sourceMappingURL=init.js.map