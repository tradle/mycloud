var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const { co, omitVirtual, bindAll, RESOLVED_PROMISE } = require('./utils');
const { prettify } = require('./string-utils');
const { PUBLIC_CONF_BUCKET, SEQ } = require('./constants');
const Errors = require('./errors');
const types = require('./typeforce-types');
module.exports = UserSim;
function UserSim({ env, logger, auth, iot, provider, delivery, buckets, messages, lambdaUtils, tasks }) {
    bindAll(this);
    this.env = env;
    this.logger = logger.sub('usersim');
    this.auth = auth;
    this.iot = iot;
    this.provider = provider;
    this.delivery = delivery;
    this.buckets = buckets;
    this.messages = messages;
    this.lambdaUtils = lambdaUtils;
    this.tasks = tasks;
}
const proto = UserSim.prototype;
proto.onSubscribed = co(function* ({ clientId, topics }) {
    this.logger.debug('client subscribed to topics:', topics.join(', '));
    if (!this.delivery.mqtt.includesClientMessagesTopic({ clientId, topics })) {
        this.logger.debug('message topic not found in topics array');
        return;
    }
    let session;
    try {
        session = yield this.auth.setSubscribed({ clientId, subscribed: true });
        this.logger.debug(`client subscribed`, session);
    }
    catch (error) {
        this.logger.error('failed to update presence information', error);
        yield this.requestIotClientReconnect({ clientId, error });
        Errors.rethrow(error, 'system');
        return;
    }
    const { permalink, clientPosition, serverPosition } = session;
    const after = (clientPosition.received && clientPosition.received.time) || 0;
    this.logger.debug(`delivering messages after time ${after}`);
    try {
        yield this.delivery.deliverMessages({
            session,
            recipient: permalink,
            range: { after }
        });
    }
    catch (error) {
        this.logger.error('live delivery failed', error);
        yield this.requestIotClientReconnect({ clientId, error });
        Errors.rethrow(error, 'system');
    }
});
proto.onSentMessage = co(function* ({ clientId, message }) {
    const { TESTING } = this.env;
    let ensureLiveSession = RESOLVED_PROMISE;
    if (clientId) {
        ensureLiveSession = this.tasks.add(this.ensureLiveSession({ clientId }));
    }
    let err;
    let processed;
    try {
        processed = yield this.provider.receiveMessage({ message });
    }
    catch (e) {
        err = e;
        if (!clientId) {
            Errors.ignore(err, Errors.Duplicate);
            return;
        }
    }
    if (processed) {
        this.logger.debug('received valid message from user');
        this.tasks.add({
            name: 'delivery:ack',
            promiser: () => __awaiter(this, void 0, void 0, function* () {
                yield ensureLiveSession;
                yield this.delivery.ack({
                    clientId,
                    message: processed
                });
            })
        });
        const { BOT_ONMESSAGE, INVOKE_BOT_LAMBDAS_DIRECTLY = TESTING } = this.env;
        if (!BOT_ONMESSAGE) {
            this.logger.warn('no bot subscribed to "onmessage"');
            return;
        }
        const arg = INVOKE_BOT_LAMBDAS_DIRECTLY ? processed : this.messages.stripData(processed);
        this.logger.debug(`passing message from ${processed._author} on to bot`);
        const resp = yield this.lambdaUtils.invoke({
            sync: true,
            local: INVOKE_BOT_LAMBDAS_DIRECTLY,
            name: BOT_ONMESSAGE,
            arg
        });
        this.logger.debug(`${BOT_ONMESSAGE} finished processing`);
        return TESTING ? resp : processed;
    }
    this.logger.debug(`processing error in receive: ${err.name}`);
    processed = err.progress;
    if (err instanceof Errors.Duplicate) {
        this.logger.info('ignoring but acking duplicate message', {
            link: processed._link,
            author: processed._author
        });
        if (!clientId)
            return;
        this.tasks.add({
            name: 'delivery:ack',
            promiser: () => __awaiter(this, void 0, void 0, function* () {
                yield ensureLiveSession;
                yield this.delivery.ack({
                    clientId,
                    message: processed
                });
            })
        });
        return;
    }
    if (err instanceof Errors.TimeTravel ||
        err instanceof Errors.NotFound ||
        err instanceof Errors.InvalidSignature ||
        err instanceof Errors.InvalidMessageFormat) {
        let logMsg;
        if (err instanceof Errors.TimeTravel) {
            logMsg = 'rejecting message with lower timestamp than previous';
        }
        else if (err instanceof Errors.NotFound) {
            logMsg = 'rejecting message, either sender or payload identity was not found';
        }
        else if (err instanceof Errors.InvalidMessageFormat) {
            logMsg = 'rejecting message, invalid message format';
        }
        else {
            logMsg = 'rejecting message, invalid signature';
        }
        this.logger.warn(logMsg, {
            message: processed,
            error: err.stack
        });
        if (!clientId) {
            err.code = 400;
            throw err;
        }
        this.tasks.add({
            name: 'delivery:reject',
            promiser: () => __awaiter(this, void 0, void 0, function* () {
                yield ensureLiveSession;
                yield this.delivery.reject({
                    clientId,
                    message: processed,
                    error: err
                });
            })
        });
        return;
    }
    this.logger.error('unexpected error in pre-processing inbound message', {
        message: processed || message,
        error: err.stack
    });
    throw err;
});
proto.onDisconnected = co(function* ({ clientId }) {
    try {
        const session = yield this.auth.setConnected({ clientId, connected: false });
        this.logger.debug(`client disconnected`, session);
    }
    catch (error) {
        this.logger.error('failed to update presence information', error);
        yield this.requestIotClientReconnect({ clientId, error });
        Errors.rethrow(error, 'system');
    }
});
proto.ensureLiveSession = function ensureLiveSession({ clientId }) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield this.auth.getMostRecentSessionByClientId(clientId);
        }
        catch (error) {
            Errors.ignore(error, Errors.NotFound);
            this.logger.debug('iot session not found', { clientId });
            yield this.requestIotClientReconnect({ clientId, error });
        }
    });
};
proto.onConnected = co(function* ({ clientId }) {
    try {
        const session = yield this.auth.setConnected({ clientId, connected: true });
        this.logger.debug(`client connected`, session);
    }
    catch (error) {
        this.logger.error('failed to update presence information', error);
        yield this.requestIotClientReconnect({ clientId, error });
        Errors.rethrow(error, 'system');
    }
});
proto.requestIotClientReconnect = function ({ clientId, error, message = 'please reconnect' }) {
    this.logger.debug('requesting iot client reconnect', error && {
        stack: error.stack
    });
    return this.delivery.mqtt.trigger({
        clientId,
        topic: 'error',
        payload: {
            message
        }
    });
};
proto.onPreAuth = function (...args) {
    return this.auth.createTemporaryIdentity(...args);
};
proto.onSentChallengeResponse = co(function* (response) {
    const time = Date.now();
    const session = yield this.auth.handleChallengeResponse(response);
    return {
        time,
        position: session.serverPosition
    };
});
proto.getProviderIdentity = co(function* () {
    const { object } = yield this.buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.identity);
    return omitVirtual(object);
});
//# sourceMappingURL=user.js.map