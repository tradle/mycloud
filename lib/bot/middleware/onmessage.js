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
const clone = require("clone");
const deepEqual = require("deep-equal");
const locker_1 = require("../locker");
const utils_1 = require("../utils");
exports.onmessage = (lambda, opts) => {
    const { autosave = true } = opts;
    const { bot, logger, isTesting } = lambda;
    const locker = locker_1.createLocker({
        name: 'inbound message lock',
        debug: lambda.logger.sub('lock:receive').debug,
        timeout: lambda.isTesting ? null : 10000
    });
    const lock = id => locker.lock(id);
    const unlock = id => locker.unlock(id);
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        let message = ctx.event;
        if (typeof message === 'string') {
            message = JSON.parse(message);
        }
        const userId = message._author;
        yield lock(userId);
        try {
            const botMessageEvent = yield utils_1.preProcessMessageEvent({ bot, message });
            const userPre = clone(botMessageEvent.user);
            yield bot.hooks.fire('message', botMessageEvent);
            yield next();
            if (opts.autosave === false)
                return;
            const { user } = botMessageEvent;
            if (deepEqual(user, userPre)) {
                logger.debug('user state was not changed by onmessage handler');
            }
            else {
                logger.debug('merging changes to user state');
                yield bot.users.merge(user);
            }
        }
        finally {
            yield unlock(userId);
        }
    });
};
//# sourceMappingURL=onmessage.js.map