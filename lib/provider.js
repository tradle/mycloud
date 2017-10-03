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
const debug_1 = require("debug");
const debug = debug_1.default('tradle:sls:provider');
const engine_1 = require("@tradle/engine");
const crypto_1 = require("./crypto");
const utils_1 = require("./utils");
const Errors = require("./errors");
const types = require("./typeforce-types");
const constants_1 = require("./constants");
const { MESSAGE } = constants_1.TYPES;
class Provider {
    constructor(tradle) {
        this.getMyKeys = () => __awaiter(this, void 0, void 0, function* () {
            const { keys } = yield this.getMyPrivateIdentity();
            return keys;
        });
        this.getMyChainKey = () => __awaiter(this, void 0, void 0, function* () {
            const { network } = this;
            const keys = yield this.getMyKeys();
            const chainKey = crypto_1.getChainKey(keys, {
                type: network.flavor,
                networkName: network.networkName
            });
            if (!chainKey) {
                throw new Error(`blockchain key not found for network: ${network}`);
            }
            return chainKey;
        });
        this.getMyChainKeyPub = () => __awaiter(this, void 0, void 0, function* () {
            const { network } = this;
            const identity = yield this.getMyPublicIdentity();
            const key = identity.pubkeys.find(pub => {
                return pub.type === network.flavor &&
                    pub.networkName === network.networkName &&
                    pub.purpose === 'messaging';
            });
            if (!key) {
                throw new Error(`no key found for blockchain network ${network.toString()}`);
            }
            return key;
        });
        this.signObject = ({ author, object }) => __awaiter(this, void 0, void 0, function* () {
            if (!author)
                author = yield this.getMyPrivateIdentity();
            const key = crypto_1.getSigningKey(author.keys);
            const signed = yield crypto_1.sign({ key, object });
            this.objects.addMetadata(signed);
            utils_1.setVirtual(signed, { _author: crypto_1.getPermalink(author.identity) });
            return signed;
        });
        this.findOrCreate = ({ link, object, author }) => __awaiter(this, void 0, void 0, function* () {
            if (!object) {
                return this.objects.getObjectByLink(link);
            }
            if (!object[constants_1.SIG]) {
                object = yield this.signObject({ author, object });
            }
            yield this.objects.putObject(object);
            this.objects.addMetadata(object);
            return object;
        });
        this.createSendMessageEvent = (opts) => __awaiter(this, void 0, void 0, function* () {
            if (!opts.time) {
                opts.time = Date.now();
            }
            if (!opts.author) {
                opts.author = yield this.getMyPrivateIdentity();
            }
            return this._createSendMessageEvent(opts);
        });
        this.receiveMessage = ({ message }) => __awaiter(this, void 0, void 0, function* () {
            try {
                message = this.messages.normalizeInbound(message);
                message = yield this.messages.preProcessInbound(message);
            }
            catch (err) {
                err.progress = message;
                debug('unexpected error in pre-processing inbound message:', err.stack);
                throw err;
            }
            try {
                return yield this.createReceiveMessageEvent({ message });
            }
            catch (err) {
                err.progress = message;
                throw err;
            }
        });
        this.createReceiveMessageEvent = ({ message }) => __awaiter(this, void 0, void 0, function* () {
            message = yield this.messages.parseInbound(message);
            yield this.objects.putObject(message.object);
            yield this.messages.putMessage(message);
            return message;
        });
        this.sendMessage = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { recipient, object, other = {} } = opts;
            const promiseCreate = this.createSendMessageEvent({ recipient, object, other });
            const promiseSession = this.auth.getLiveSessionByPermalink(recipient);
            const message = yield promiseCreate;
            let session;
            try {
                session = yield promiseSession;
            }
            catch (err) {
                debug(`mqtt session not found for ${recipient}`);
            }
            try {
                yield this.attemptLiveDelivery({ recipient, message, session });
            }
            catch (err) {
                if (err instanceof Errors.NotFound) {
                    debug('live delivery canceled', err.stack);
                }
                else {
                    debug('live delivery failed', err);
                    throw err;
                }
            }
            return message;
        });
        this.attemptLiveDelivery = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { message, recipient, session = {} } = opts;
            debug(`sending message (time=${message.time}) to ${recipient} live`);
            yield this.tradle.delivery.deliverBatch({
                clientId: session.clientId,
                recipient,
                messages: [message]
            });
        });
        this.lookupMyIdentity = () => {
            return this.secrets.get(constants_1.IDENTITY_KEYS_KEY);
        };
        this.lookupMyPublicIdentity = () => {
            return this.buckets.PublicConf.getJSON(constants_1.PUBLIC_CONF_BUCKET.identity);
        };
        this.getMyPrivateIdentity = utils_1.cachifyPromiser(this.lookupMyIdentity);
        this.getMyPublicIdentity = utils_1.cachifyPromiser(this.lookupMyPublicIdentity);
        this._createSendMessageEvent = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { author, recipient, link, object, other = {} } = opts;
            utils_1.typeforce({
                recipient: types.link,
                object: utils_1.typeforce.maybe(utils_1.typeforce.Object),
                other: utils_1.typeforce.maybe(utils_1.typeforce.Object),
            }, opts);
            const promisePayload = this.findOrCreate({ link, object, author });
            const promisePrev = this.messages.getLastSeqAndLink({ recipient });
            const promiseRecipient = this.identities.getIdentityByPermalink(recipient);
            const [payload, recipientObj] = yield Promise.all([
                promisePayload,
                promiseRecipient
            ]);
            const payloadVirtual = utils_1.pickVirtual(payload);
            const unsignedMessage = utils_1.clone(other, {
                [constants_1.TYPE]: MESSAGE,
                recipientPubKey: engine_1.utils.sigPubKey(recipientObj),
                object: payload,
                time: opts.time
            });
            let attemptsToGo = 3;
            let prev = yield promisePrev;
            let seq;
            let signedMessage;
            while (attemptsToGo--) {
                utils_1.extend(unsignedMessage, this.messages.getPropsDerivedFromLast(prev));
                seq = unsignedMessage[constants_1.SEQ];
                debug(`signing message ${seq} to ${recipient}`);
                signedMessage = yield this.signObject({ author, object: unsignedMessage });
                utils_1.setVirtual(signedMessage, {
                    _author: crypto_1.getPermalink(author.identity),
                    _recipient: crypto_1.getPermalink(recipientObj)
                });
                utils_1.setVirtual(signedMessage.object, payloadVirtual);
                try {
                    yield this.messages.putMessage(signedMessage);
                    return signedMessage;
                }
                catch (err) {
                    if (err.code !== 'ConditionalCheckFailedException') {
                        throw err;
                    }
                    debug(`seq ${seq} was taken by another message`);
                    prev = yield this.messages.getLastSeqAndLink({ recipient });
                    debug(`retrying with seq ${seq}`);
                }
            }
            const err = new Errors.PutFailed('failing after 3 retries');
            err.retryable = true;
            throw err;
        });
        this.tradle = tradle;
        this.objects = tradle.objects;
        this.messages = tradle.messages;
        this.secrets = tradle.secrets;
        this.identities = tradle.identities;
        this.buckets = tradle.buckets;
        this.auth = tradle.auth;
        this.network = tradle.network;
    }
}
exports.default = Provider;
//# sourceMappingURL=provider.js.map