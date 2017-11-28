const { co, omitVirtual, bindAll } = require('./utils');
const { prettify } = require('./string-utils');
const { PUBLIC_CONF_BUCKET, SEQ } = require('./constants');
const Errors = require('./errors');
const types = require('./typeforce-types');
module.exports = UserSim;
function UserSim({ env, auth, iot, provider, delivery, buckets, messages, lambdaUtils }) {
    bindAll(this);
    this.env = env;
    this.logger = env.sublogger('usersim');
    this.auth = auth;
    this.iot = iot;
    this.provider = provider;
    this.delivery = delivery;
    this.buckets = buckets;
    this.messages = messages;
    this.lambdaUtils = lambdaUtils;
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
        this.logger.debug(`client subscribed: ${clientId}`, session);
    }
    catch (err) {
        this.logger.error('failed to update presence information', err);
        yield this.requestIotClientReconnect({ clientId });
        Errors.rethrow(err, 'system');
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
    catch (err) {
        this.logger.error('failed to update presence information', err);
        yield this.requestIotClientReconnect({ clientId });
        Errors.rethrow(err, 'system');
    }
});
proto.onSentMessage = co(function* ({ clientId, message }) {
    const { TESTING } = this.env;
    let err;
    let processed;
    try {
        processed = yield this.provider.receiveMessage({ message });
    }
    catch (e) {
        err = e;
        if (!clientId) {
            this.logger.error('failed to process inbound message:', {
                message,
                error: err.stack
            });
            throw err;
        }
    }
    if (processed) {
        this.logger.debug('received valid message from user');
        yield this.delivery.ack({
            clientId,
            message: processed
        });
        const { BOT_ONMESSAGE, INVOKE_BOT_LAMBDAS_DIRECTLY = TESTING } = this.env;
        if (!BOT_ONMESSAGE) {
            this.logger.warn('no bot subscribed to "onmessage"');
            return;
        }
        const neutered = this.messages.stripData(processed);
        this.logger.debug(`passing message from ${processed._author} on to bot`);
        const resp = yield this.lambdaUtils.invoke({
            sync: true,
            local: INVOKE_BOT_LAMBDAS_DIRECTLY,
            name: BOT_ONMESSAGE,
            arg: neutered
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
        yield this.delivery.ack({
            clientId,
            message: processed
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
        yield this.delivery.reject({
            clientId,
            message: processed,
            error: err
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
        yield this.auth.setConnected({ clientId, connected: false });
        this.logger.debug(`client disconnected: ${clientId}`);
    }
    catch (err) {
        this.logger.error('failed to update presence information', err);
        yield this.requestIotClientReconnect({ clientId });
        Errors.rethrow(err, 'system');
    }
});
proto.onConnected = co(function* ({ clientId }) {
    try {
        yield this.auth.setConnected({ clientId, connected: true });
        this.logger.debug(`client connected: ${clientId}`);
    }
    catch (err) {
        this.logger.error('failed to update presence information', err);
        yield this.requestIotClientReconnect({ clientId });
        Errors.rethrow(err, 'system');
    }
});
proto.requestIotClientReconnect = function ({ clientId, message = 'please reconnect' }) {
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