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
const string_utils_1 = require("../../string-utils");
const lambda_1 = require("../lambda");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromIot(opts);
    lambda.tasks.add({
        name: 'getiotendpoint',
        promiser: lambda.bot.iot.getEndpoint
    });
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { logger, tradle, bot } = lambda;
    const { user, auth } = tradle;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        let { event } = ctx;
        if (Buffer.isBuffer(event)) {
            ctx.event = event = JSON.parse(event.toString());
        }
        logger.debug('client disconnected', string_utils_1.prettify(event));
        const { clientId } = event;
        yield user.onDisconnected({ clientId });
        yield bot.hooks.fire('user:offline', auth.getPermalinkFromClientId(clientId));
        yield next();
    });
};
//# sourceMappingURL=ondisconnect.js.map