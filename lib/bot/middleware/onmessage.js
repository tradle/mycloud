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
const clone = require("clone");
const deepEqual = require("deep-equal");
const IotMessage = require("@tradle/iot-message");
const locker_1 = require("../locker");
const utils_1 = require("../../utils");
const utils_2 = require("../utils");
exports.preProcessInbox = (lambda, opts) => {
    const { logger, tradle } = lambda;
    const { user } = tradle;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { messages } = ctx.event;
        logger.debug(`preprocessing ${messages.length} messages in inbox`);
        ctx.messages = Promise.mapSeries(messages, message => user.onSentMessage({ message }));
        logger.debug(`preprocessed ${messages.length} messages in inbox`);
        yield next();
    });
};
exports.preProcessIotMessage = (lambda, opts) => {
    const { logger, tradle, tasks, isUsingServerlessOffline } = lambda;
    const { user } = tradle;
    tasks.add({
        name: 'getiotendpoint',
        promiser: tradle.iot.getEndpoint
    });
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { event, context } = ctx;
        let { topic, clientId, data } = event;
        if (!clientId && isUsingServerlessOffline) {
            clientId = topic.match(/\/([^/]+)\/[^/]+/)[1];
        }
        const buf = typeof data === 'string' ? new Buffer(data, 'base64') : data;
        let message;
        try {
            message = yield IotMessage.decode(buf);
        }
        catch (err) {
            logger.error('client sent invalid MQTT payload', err.stack);
            yield user.onIncompatibleClient({ clientId });
            return;
        }
        const processed = yield user.onSentMessage({ clientId, message });
        if (processed) {
            ctx.messages = [processed];
            logger.debug('preprocessed message');
            yield next();
        }
    });
};
exports.onmessage = (lambda, opts) => {
    const { autosave = true } = opts;
    const { bot, tradle, tasks, logger, isTesting } = lambda;
    const locker = locker_1.createLocker({
        name: 'inbound message lock',
        debug: lambda.logger.sub('lock:receive').debug,
        timeout: lambda.isTesting ? null : 10000
    });
    const lock = id => locker.lock(id);
    const unlock = id => locker.unlock(id);
    tasks.add({
        name: 'getiotendpoint',
        promiser: tradle.iot.getEndpoint
    });
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { messages } = ctx;
        if (!messages)
            return;
        const byUser = utils_1.groupBy(messages, '_author');
        yield utils_1.allSettled(Object.keys(byUser).map((userId) => __awaiter(this, void 0, void 0, function* () {
            let userPre;
            let botMessageEvent;
            yield lock(userId);
            try {
                for (const message of messages) {
                    botMessageEvent = yield utils_2.preProcessMessageEvent({ bot, message });
                    if (!userPre)
                        userPre = clone(botMessageEvent.user);
                    yield bot.hooks.fire('message', botMessageEvent);
                }
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
        })));
        yield next();
    });
};
//# sourceMappingURL=onmessage.js.map