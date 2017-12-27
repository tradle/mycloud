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
const utils_1 = require("./utils");
const string_utils_1 = require("./string-utils");
const constants_1 = require("./constants");
const Errors = require("./errors");
const notNull = val => !!val;
const ClientErrors = {
    reconnect_required: 'reconnect_required',
    incompatible_client: 'incompatible_client'
};
class User {
    constructor(tradle) {
        this.onSubscribed = ({ clientId, topics }) => __awaiter(this, void 0, void 0, function* () {
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
            yield this.maybeDeliverMessagesToClient(session);
        });
        this.maybeDeliverMessagesToClient = (session) => __awaiter(this, void 0, void 0, function* () {
            if (!(session.connected && session.authenticated)) {
                this.logger.debug(`can't deliver messages, client is, ${getDeliveryReadiness(session)}`);
                return;
            }
            const { clientId, permalink, clientPosition, serverPosition } = session;
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
        this.onSentMessages = ({ clientId, messages }) => __awaiter(this, void 0, void 0, function* () {
            const processed = yield Promise.mapSeries(messages, message => this.onSentMessage({ clientId, message }));
            return processed.filter(notNull);
        });
        this.onSentMessage = ({ clientId, message }) => __awaiter(this, void 0, void 0, function* () {
            const { TESTING } = this.env;
            let err;
            let processed;
            try {
                processed = yield this.provider.receiveMessage({ clientId, message });
            }
            catch (e) {
                err = e;
                if (!clientId) {
                    Errors.ignore(err, Errors.Duplicate);
                    return;
                }
            }
            yield this._postProcessMessage({
                clientId,
                message: processed || message,
                error: err
            });
            return err ? null : processed;
        });
        this._postProcessMessage = ({ clientId, message, error }) => __awaiter(this, void 0, void 0, function* () {
            const progress = error && error.progress;
            const ack = () => {
                this.tasks.add({
                    name: 'delivery:ack',
                    promiser: () => __awaiter(this, void 0, void 0, function* () {
                        yield this.delivery.ack({ clientId, message: message || progress });
                    })
                });
            };
            if (!error) {
                this.logger.debug('received valid message from user');
                ack();
                return;
            }
            const reject = () => {
                this.tasks.add({
                    name: 'delivery:reject',
                    promiser: () => __awaiter(this, void 0, void 0, function* () {
                        yield this.delivery.reject({
                            clientId,
                            message: progress,
                            error
                        });
                    })
                });
            };
            this.logger.debug(`processing error in receive: ${error.name}`);
            if (error instanceof Errors.Duplicate) {
                this.logger.info('ignoring but acking duplicate message', {
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
                this.logger.warn(logMsg, {
                    message: progress,
                    error: error.stack
                });
                reject();
                return;
            }
            this.logger.error('unexpected error in pre-processing inbound message', {
                message: progress || message,
                error: error.stack
            });
            throw error;
        });
        this.onDisconnected = ({ clientId }) => __awaiter(this, void 0, void 0, function* () {
            try {
                const session = yield this.auth.setConnected({ clientId, connected: false });
                this.logger.debug(`client disconnected`, session);
                return session;
            }
            catch (error) {
                this.logger.error('failed to update presence information', error);
                yield this.requestIotClientReconnect({ clientId, error });
                Errors.rethrow(error, 'system');
            }
        });
        this.ensureLiveSession = ({ clientId }) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.auth.getMostRecentSessionByClientId(clientId);
            }
            catch (error) {
                Errors.ignore(error, Errors.NotFound);
                this.logger.debug('iot session not found', { clientId });
                yield this.requestIotClientReconnect({ clientId, error });
            }
        });
        this.onConnected = ({ clientId }) => __awaiter(this, void 0, void 0, function* () {
            let session;
            try {
                session = yield this.auth.setConnected({ clientId, connected: true });
                this.logger.debug(`client connected`, session);
            }
            catch (error) {
                this.logger.error('failed to update presence information', error);
                yield this.requestIotClientReconnect({ clientId, error });
                Errors.rethrow(error, 'system');
                return;
            }
            yield this.maybeDeliverMessagesToClient(session);
            return session;
        });
        this.onIncompatibleClient = ({ clientId }) => __awaiter(this, void 0, void 0, function* () {
            yield this.sendError({ clientId, message: ClientErrors.incompatible_client });
        });
        this.sendError = ({ clientId, message }) => __awaiter(this, void 0, void 0, function* () {
            yield this.delivery.mqtt.trigger({
                clientId,
                topic: 'error',
                payload: {
                    message
                }
            });
        });
        this.requestIotClientReconnect = ({ clientId, error, message = ClientErrors.reconnect_required }) => __awaiter(this, void 0, void 0, function* () {
            this.logger.debug('requesting iot client reconnect', error && {
                stack: error.stack
            });
            yield this.sendError({ clientId, message });
        });
        this.getProviderIdentity = () => __awaiter(this, void 0, void 0, function* () {
            const { object } = yield this.buckets.PublicConf.getJSON(constants_1.PUBLIC_CONF_BUCKET.identity);
            return utils_1.omitVirtual(object);
        });
        const { env, logger, auth, iot, provider, delivery, buckets, messages, lambdaUtils, tasks } = tradle;
        this.env = env;
        this.logger = logger.sub('user');
        this.auth = auth;
        this.iot = iot;
        this.provider = provider;
        this.delivery = delivery;
        this.buckets = buckets;
        this.messages = messages;
        this.lambdaUtils = lambdaUtils;
        this.tasks = tasks;
    }
}
exports.default = User;
const getDeliveryReadiness = session => {
    return string_utils_1.prettify(utils_1.pick(session, ['connected', 'subscribed']));
};
//# sourceMappingURL=user.js.map