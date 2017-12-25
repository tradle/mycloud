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
const body_parser_1 = require("../middleware/body-parser");
const lambda_1 = require("../lambda");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromHTTP(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    return compose([
        cors(),
        body_parser_1.bodyParser(),
        exports.auth(lambda, opts)
    ]);
};
exports.auth = (lambda, opts) => {
    const { tradle, bot } = lambda;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const time = Date.now();
        ctx.session = yield tradle.auth.handleChallengeResponse(ctx.request.body);
        ctx.userId = ctx.session.permalink;
        yield bot.hooks.fire('user:authenticated', ctx.userId);
        yield next();
        if (ctx.body) {
            return;
        }
        const { session, role = tradle.serviceMap.Role.IotClient } = ctx;
        const credentials = yield tradle.auth.createCredentials(session, role);
        ctx.body = Object.assign({ time, position: session.serverPosition }, credentials);
    });
};
//# sourceMappingURL=auth.js.map