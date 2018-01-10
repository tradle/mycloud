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
        this.onAnnouncePosition = ({ clientId, session, position }) => __awaiter(this, void 0, void 0, function* () {
            if (!session)
                session = yield this.ensureLiveSession({ clientId });
            const { clientPosition } = session;
            if (!clientPosition) {
                this.logger.error('expected session to have clientPosition', { session });
                yield this.requestIotClientReconnect({ clientId });
                return;
            }
            const { received = clientPosition.received } = position;
            if (received.time < clientPosition.received.time) {
                const message = 'position requested cannot be less than advertised during auth';
                this.logger.error(message, { session, position });
                yield this.requestIotClientReconnect({ clientId, message });
                return;
            }
            yield this.maybeDeliverMessagesToClient(Object.assign({}, session, { clientPosition: Object.assign({}, clientPosition, { received }) }));
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
            return yield this.provider.receiveMessage({ clientId, message });
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
                return yield this.auth.getMostRecentSessionByClientId(clientId);
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
exports.User = User;
const getDeliveryReadiness = session => {
    return string_utils_1.prettify(_.pick(session, ['connected', 'subscribed']));
};
//# sourceMappingURL=user.js.map