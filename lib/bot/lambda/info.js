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
const compose = require("koa-compose");
const cors = require("kcors");
const lambda_1 = require("../lambda");
const noop_route_1 = require("../middleware/noop-route");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromHTTP(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { bot, logger } = lambda;
    return compose([
        cors(),
        (ctx, next) => __awaiter(this, void 0, void 0, function* () {
            logger.debug('setting bot endpoint info');
            if (!ctx.body)
                ctx.body = {};
            Object.assign(ctx.body, bot.endpointInfo);
            yield next();
        }),
        noop_route_1.get('/info')
    ]);
};
//# sourceMappingURL=info.js.map