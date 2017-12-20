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
const noop_route_1 = require("../middleware/noop-route");
const body_parser_1 = require("../middleware/body-parser");
const lambda_1 = require("../../lambda");
exports.createLambda = (opts) => {
    const lambda = opts.bot.createLambda(Object.assign({ source: lambda_1.EventSource.HTTP }, opts));
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { tradle, bot } = lambda;
    const { auth, serviceMap } = tradle;
    return compose([
        cors(),
        body_parser_1.bodyParser(),
        (ctx, next) => __awaiter(this, void 0, void 0, function* () {
            const time = Date.now();
            ctx.session = yield auth.handleChallengeResponse(ctx.request.body);
            ctx.userId = ctx.session.permalink;
            yield next();
            if (ctx.body) {
                return;
            }
            const { session, role = serviceMap.Role.IotClient } = ctx;
            const credentials = yield auth.createCredentials(session, role);
            ctx.body = Object.assign({ time, position: session.serverPosition }, credentials);
        }),
        noop_route_1.post('/auth')
    ]);
};
//# sourceMappingURL=auth.js.map