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
const constants_1 = require("@tradle/constants");
const locker_1 = require("../locker");
const utils_1 = require("../../utils");
const lambda_1 = require("../lambda");
exports.createMiddleware = (lambda, opts) => {
    const stack = [
        exports.onMessagesSaved(lambda, opts)
    ];
    if (lambda.source !== lambda_1.EventSource.DYNAMODB && lambda.isUsingServerlessOffline) {
        stack.push(exports.toStreamAndProcess(lambda, opts));
    }
    return compose(stack);
};
exports.onMessagesSaved = (lambda, opts = {}) => {
    const { bot, tradle, tasks, logger, isTesting } = lambda;
    const locker = locker_1.createLocker({
        name: 'inbound message lock',
        debug: lambda.logger.sub('lock:receive').debug,
        timeout: lambda.isTesting ? null : 10000
    });
    const lock = id => locker.lock(id);
    const unlock = id => locker.unlock(id);
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { messages } = ctx.event;
        if (!messages)
            return;
        const authors = utils_1.uniqueStrict(messages.map(({ _author }) => _author));
        if (authors.length > 1) {
            throw new Error('only messages from a single author allowed');
        }
        const userId = authors[0];
        yield lock(userId);
        try {
            ctx.user = yield bot.users.createIfNotExists({ id: userId });
            const { user } = ctx;
            for (const message of messages) {
                const botMessageEvent = toBotMessageEvent({ bot, user, message });
                yield bot.hooks.fire('message', botMessageEvent);
            }
        }
        finally {
            yield unlock(userId);
        }
        yield next();
    });
};
exports.toStreamAndProcess = (lambda, opts) => {
    const onMessageStream = require('./onmessagestream');
    return compose([
        toStream(lambda, opts),
        onMessageStream.createMiddleware(lambda, opts)
    ]);
};
const toBotMessageEvent = ({ bot, user, message }) => {
    const payload = message.object;
    const type = payload[constants_1.TYPE];
    return {
        bot,
        user,
        message,
        payload,
        type,
        link: payload._link,
        permalink: payload._permalink,
    };
};
const toStream = (lambda, opts) => {
    const { toStreamItems } = require('../../test/utils');
    const { tradle } = lambda;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        ctx.event = toStreamItems(ctx.event.messages.map(m => {
            return {
                new: tradle.messages.formatForDB(m)
            };
        }));
        yield next();
    });
};
//# sourceMappingURL=onmessagessaved.js.map