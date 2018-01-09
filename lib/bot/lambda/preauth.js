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
const cors = require("kcors");
const compose = require("koa-compose");
const noop_route_1 = require("../middleware/noop-route");
const body_parser_1 = require("../middleware/body-parser");
const lambda_1 = require("../lambda");
const utils_1 = require("../../utils");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromHTTP(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { tradle, bot } = lambda;
    const { auth, serviceMap } = tradle;
    return compose([
        noop_route_1.post(),
        cors(),
        body_parser_1.bodyParser(),
        (ctx, next) => __awaiter(this, void 0, void 0, function* () {
            const ips = utils_1.getRequestIps(ctx.request);
            const { clientId, identity } = ctx.event;
            ctx.session = yield auth.createSession({ clientId, identity, ips });
            yield next();
            if (!ctx.body)
                ctx.body = ctx.session;
        })
    ]);
};
//# sourceMappingURL=preauth.js.map