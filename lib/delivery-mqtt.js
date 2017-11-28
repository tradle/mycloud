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
const events_1 = require("events");
const constants_1 = require("@tradle/constants");
const Errors = require("./errors");
const utils_1 = require("./utils");
const MAX_PAYLOAD_SIZE = 115000;
class DeliveryIot extends events_1.EventEmitter {
    constructor({ env, iot, auth, messages, objects }) {
        super();
        this.includesClientMessagesTopic = ({ clientId, topics }) => {
            const catchAllTopic = `${clientId}/sub/+`;
            const messagesTopic = `${clientId}/sub/inbox`;
            return topics
                .map(topic => this._unprefixTopic(topic))
                .find(topic => topic === messagesTopic || topic === catchAllTopic);
        };
        this.canReceive = ({ clientId, session }) => __awaiter(this, void 0, void 0, function* () {
            if (!session) {
                session = yield this.auth.getMostRecentSessionByClientId(clientId);
            }
            return session.authenticated && session.connected;
        });
        this.deliverBatch = ({ session, recipient, messages }) => __awaiter(this, void 0, void 0, function* () {
            if (!(session.authenticated && session.connected)) {
                throw new Errors.ClientUnreachable('client must be authenticated and connected');
            }
            const seqs = messages.map(m => m[constants_1.SEQ]);
            this.logger.debug(`delivering ${messages.length} messages to ${recipient}: ${seqs.join(', ')}`);
            const strings = messages.map(stringify);
            const subBatches = utils_1.batchStringsBySize(strings, MAX_PAYLOAD_SIZE);
            for (let subBatch of subBatches) {
                yield this.trigger({
                    clientId: session.clientId,
                    topic: 'inbox',
                    payload: `{"messages":[${subBatch.join(',')}]}`
                });
            }
            this.logger.debug(`delivered ${messages.length} messages to ${recipient}`);
        });
        this.ack = ({ clientId, message }) => {
            this.logger.debug(`acking message from ${clientId}`);
            const stub = this.messages.getMessageStub({ message });
            return this.trigger({
                clientId,
                topic: 'ack',
                payload: {
                    message: stub
                }
            });
        };
        this.reject = ({ clientId, message, error }) => {
            this.logger.debug(`rejecting message from ${clientId}`, error);
            const stub = this.messages.getMessageStub({ message, error });
            return this.trigger({
                clientId,
                topic: 'reject',
                payload: {
                    message: stub,
                    reason: Errors.export(error)
                }
            });
        };
        this.trigger = ({ clientId, topic, payload }) => {
            return this.iot.publish({
                topic: this._prefixTopic(`${clientId}/sub/${topic}`),
                payload
            });
        };
        this._prefixTopic = (topic) => {
            return `${this._parentTopic}/${topic}`;
        };
        this._unprefixTopic = (topic) => {
            return topic.slice(this._parentTopic.length + 1);
        };
        this.env = env;
        this.logger = env.sublogger('delivery-iot');
        this.iot = iot;
        this.auth = auth;
        this.messages = messages;
        this.objects = objects;
        this._parentTopic = env.IOT_PARENT_TOPIC;
    }
}
exports.default = DeliveryIot;
const stringify = msg => JSON.stringify(utils_1.omitVirtual(msg));
//# sourceMappingURL=delivery-mqtt.js.map