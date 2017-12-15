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
const Router = require("koa-router");
const cors = require("kcors");
const configure_1 = require("../../configure");
const bot_1 = require("../../../bot");
const bot = bot_1.createBot();
const lambda = bot.lambdas.info();
const { logger } = lambda;
const conf = configure_1.createConf({ bot });
const router = new Router();
router.get('/info', (ctx, next) => __awaiter(this, void 0, void 0, function* () {
    const result = yield conf.info.get();
    if (!ctx.body)
        ctx.body = {};
    Object.assign(ctx.body, result);
}));
lambda.use(cors());
lambda.use(router.routes());
bot.ready();
exports.handler = lambda.handler;
//# sourceMappingURL=info.js.map