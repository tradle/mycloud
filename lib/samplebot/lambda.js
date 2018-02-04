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
const lambda_1 = require("../bot/lambda");
exports.EventSource = lambda_1.EventSource;
const bot_1 = require("../bot");
const customize_1 = require("./customize");
exports.createLambda = opts => {
    const { event, bot = bot_1.createBot({ ready: false }) } = opts;
    const lambda = new lambda_1.Lambda(Object.assign({ bot }, opts));
    const componentsPromise = customize_1.customize({ lambda, event });
    lambda.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
        ctx.components = yield componentsPromise;
        yield next();
    }));
    return lambda;
};
//# sourceMappingURL=lambda.js.map