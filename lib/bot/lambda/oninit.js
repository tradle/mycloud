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
const _ = require("lodash");
const cfn_response_1 = require("../../cfn-response");
const lambda_1 = require("../lambda");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromCloudFormation(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { bot } = lambda;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { event, context } = ctx;
        const { RequestType, ResourceProperties, ResponseURL } = event;
        lambda.logger.debug(`received stack event: ${RequestType}`);
        let type = RequestType.toLowerCase();
        ctx.event = {
            type: type === 'create' ? 'init' : type,
            payload: ResourceProperties
        };
        let err;
        try {
            yield bot.hooks.fire('init', ctx.event);
        }
        catch (e) {
            err = e;
        }
        if (ResponseURL) {
            const respond = err ? cfn_response_1.sendError : cfn_response_1.sendSuccess;
            const data = err ? _.pick(err, ['message', 'stack']) : {};
            yield respond(event, context, data);
        }
        if (err)
            throw err;
        yield next();
    });
};
//# sourceMappingURL=oninit.js.map