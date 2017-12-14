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
exports.createLambda = (opts) => {
    return exports.outfitLambda(opts.bot.createLambda(Object.assign({ source: lambda_1.EventSource.HTTP }, opts)), opts);
};
exports.outfitLambda = (lambda, opts) => {
    const { bot, logger } = lambda;
    lambda.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
        logger.debug('setting bot endpoint info');
        if (!ctx.body)
            ctx.body = {};
        Object.assign(ctx.body, bot.endpointInfo);
        yield next();
    }));
    return lambda;
};
//# sourceMappingURL=info.js.map