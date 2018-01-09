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
const lambda_1 = require("../../bot/lambda");
const bot_1 = require("../../bot");
const customize_1 = require("../customize");
const isLocal = process.env.IS_OFFLINE;
const bot = bot_1.createBot({ ready: false });
const lambda = isLocal
    ? lambda_1.fromHTTP({ bot, devModeOnly: true })
    : lambda_1.fromCli({ bot });
const promiseComponents = customize_1.customize({ lambda, event: 'message' });
if (isLocal) {
    lambda.use(require('../../bot/middleware/body-parser').bodyParser());
    lambda.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
        ctx.event = Object.keys(ctx.event)[0];
        yield next();
    }));
}
lambda.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
    const command = ctx.event;
    if (typeof command !== 'string') {
        throw new Error('expected command string');
    }
    const { productsAPI, commands } = yield promiseComponents;
    ctx.body = yield commands.exec({
        req: productsAPI.state.newRequestState({}),
        command,
        sudo: true
    });
}));
exports.handler = lambda.handler;
//# sourceMappingURL=cli.js.map