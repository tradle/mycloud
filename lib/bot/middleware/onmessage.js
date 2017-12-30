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
const Promise = require("bluebird");
const notNull = val => !!val;
exports.onMessage = (lambda, { onSuccess, onError }) => {
    const { logger, tradle, tasks, isUsingServerlessOffline } = lambda;
    const { user } = tradle;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        ctx.event.messages = yield Promise.mapSeries(ctx.event.messages, (message, i) => __awaiter(this, void 0, void 0, function* () {
            try {
                message = tradle.messages.normalizeInbound(message);
                message = yield user.onSentMessage({
                    message,
                    clientId: ctx.clientId,
                    friend: ctx.friend
                });
            }
            catch (error) {
                yield onError({ clientId: ctx.clientId, error, message });
                return;
            }
            yield onSuccess(message);
            return message;
        }));
        ctx.event.messages = ctx.event.messages.filter(notNull);
        if (ctx.event.messages.length) {
            logger.debug('preprocessed messages');
            yield next();
        }
    });
};
//# sourceMappingURL=onmessage.js.map