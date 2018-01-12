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
const errors_1 = require("../../errors");
const noop_route_1 = require("../middleware/noop-route");
const body_parser_1 = require("../middleware/body-parser");
const lambda_1 = require("../lambda");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromHTTP(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    return compose([
        noop_route_1.post(),
        cors(),
        body_parser_1.bodyParser(),
        exports.auth(lambda, opts)
    ]);
};
exports.auth = (lambda, opts) => {
    const { tradle, bot } = lambda;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const time = Date.now();
        try {
            ctx.session = yield tradle.auth.handleChallengeResponse(ctx.request.body);
        }
        catch (err) {
            errors_1.default.rethrow(err, 'system');
            ctx.status = 400;
            if (errors_1.default.matches(err, errors_1.default.HandshakeFailed)) {
                ctx.body = {
                    message: err.message
                };
            }
            else {
                ctx.body = {
                    message: 'failed, please retry'
                };
            }
            return;
        }
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