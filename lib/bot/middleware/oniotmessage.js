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
const IotMessage = require("@tradle/iot-message");
const Errors = require("../../errors");
const notNull = val => !!val;
exports.onMessage = (lambda, opts) => {
    const { logger, tradle, tasks, isUsingServerlessOffline } = lambda;
    const { user } = tradle;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { event, context } = ctx;
        let { topic, clientId, data } = event;
        if (!clientId && isUsingServerlessOffline) {
            clientId = topic.match(/\/([^/]+)\/[^/]+/)[1];
        }
        ctx.clientId = clientId;
        const buf = typeof data === 'string' ? new Buffer(data, 'base64') : data;
        let messages;
        try {
            const payload = yield IotMessage.decode(buf);
            ctx.event.messages = JSON.parse(payload.toString()).messages;
        }
        catch (err) {
            logger.error('client sent invalid MQTT payload', err.stack);
            yield user.onIncompatibleClient({ clientId });
            return;
        }
        yield next();
    });
};
exports.createSuccessHandler = (lambda, opts) => {
    const { tasks, logger, tradle } = lambda;
    return ({ clientId, message, error }) => __awaiter(this, void 0, void 0, function* () {
        const { delivery } = tradle;
        tasks.add({
            name: 'delivery:ack',
            promiser: () => __awaiter(this, void 0, void 0, function* () {
                yield delivery.mqtt.ack({ clientId, message });
            })
        });
        logger.debug('received valid message from user');
    });
};
exports.createErrorHandler = (lambda, opts) => {
    const { tasks, logger, tradle } = lambda;
    const { delivery } = tradle;
    return ({ clientId, message, error }) => __awaiter(this, void 0, void 0, function* () {
        const progress = error && error.progress;
        const ack = () => {
            tasks.add({
                name: 'delivery:ack',
                promiser: () => __awaiter(this, void 0, void 0, function* () {
                    yield delivery.mqtt.ack({ clientId, message: message || progress });
                })
            });
        };
        const reject = () => {
            tasks.add({
                name: 'delivery:reject',
                promiser: () => __awaiter(this, void 0, void 0, function* () {
                    yield delivery.mqtt.reject({
                        clientId,
                        message: progress,
                        error
                    });
                })
            });
        };
        logger.debug(`processing error in receive: ${error.name}`);
        if (error instanceof Errors.Duplicate) {
            logger.info('ignoring but acking duplicate message', {
                link: progress._link,
                author: progress._author
            });
            ack();
            return;
        }
        if (error instanceof Errors.TimeTravel ||
            error instanceof Errors.NotFound ||
            error instanceof Errors.InvalidSignature ||
            error instanceof Errors.InvalidMessageFormat) {
            let logMsg;
            if (error instanceof Errors.TimeTravel) {
                logMsg = 'rejecting message with lower timestamp than previous';
            }
            else if (error instanceof Errors.NotFound) {
                logMsg = 'rejecting message, either sender or payload identity was not found';
            }
            else if (error instanceof Errors.InvalidMessageFormat) {
                logMsg = 'rejecting message, invalid message format';
            }
            else {
                logMsg = 'rejecting message, invalid signature';
            }
            logger.warn(logMsg, {
                message: progress,
                error: error.stack
            });
            reject();
            return;
        }
        logger.error('unexpected error in pre-processing inbound message', {
            message: progress || message,
            error: error.stack
        });
        throw error;
    });
};
//# sourceMappingURL=oniotmessage.js.map