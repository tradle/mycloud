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
const Cache = require("lru-cache");
const buildResource = require("@tradle/build-resource");
const crypto_1 = require("./crypto");
const utils_1 = require("./utils");
const Errors = require("./errors");
exports.getChallenge = ({ nonce, salt }) => crypto_1.sha256(nonce + salt);
exports.getNotificationData = ({ nonce, seq }) => crypto_1.sha256(seq + nonce);
exports.createSubscriberInfo = () => ({ seq: -1 });
class Push {
    constructor({ serverUrl, conf, logger }) {
        this.ensureRegistered = ({ identity, key }) => __awaiter(this, void 0, void 0, function* () {
            const registered = yield this.isRegistered();
            if (!registered)
                yield this.register({ identity, key });
        });
        this.isRegistered = () => this.registration.exists(this.serverUrl);
        this.setRegistered = () => __awaiter(this, void 0, void 0, function* () {
            yield this.registration.put(this.serverUrl, {
                dateRegistered: Date.now()
            });
        });
        this.register = ({ identity, key }) => __awaiter(this, void 0, void 0, function* () {
            const nonce = yield utils_1.post(`${this.serverUrl}/publisher`, {
                identity,
                key: key.toJSON()
            });
            const salt = crypto_1.randomString(32, 'base64');
            const sig = yield key.promiseSign(exports.getChallenge({ nonce, salt }));
            yield utils_1.post(`${this.serverUrl}/publisher`, { nonce, salt, sig });
            yield this.setRegistered();
        });
        this.getSubscriber = (subscriber) => __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.subscribers.get(subscriber);
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                return exports.createSubscriberInfo();
            }
        });
        this.incrementSubscriberNotificationCount = (subscriber) => __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.subscribers.update(subscriber, {
                    UpdateExpression: 'ADD #value.#seq :incr',
                    ExpressionAttributeNames: {
                        '#value': 'value',
                        '#seq': 'seq'
                    },
                    ExpressionAttributeValues: {
                        ':incr': 1
                    },
                    ReturnValues: 'ALL_NEW'
                });
            }
            catch (err) {
                Errors.ignore(err, Errors.InvalidInput);
                const info = exports.createSubscriberInfo();
                info.seq++;
                yield this.subscribers.put(subscriber, info);
                return info;
            }
        });
        this.saveError = ({ error, subscriber }) => __awaiter(this, void 0, void 0, function* () {
            return yield this.subscribers.update(subscriber, {
                UpdateExpression: 'ADD #value.#errorCount :incr',
                ExpressionAttributeNames: {
                    '#value': 'value',
                    '#errorCount': 'errorCount'
                },
                ExpressionAttributeValues: {
                    ':incr': 1
                },
                ReturnValues: 'ALL_NEW'
            });
        });
        this.push = ({ identity, key, subscriber }) => __awaiter(this, void 0, void 0, function* () {
            yield this.ensureRegistered({ identity, key });
            const info = yield this.incrementSubscriberNotificationCount(subscriber);
            const { seq } = info;
            const nonce = crypto_1.randomString(8, 'base64');
            const sig = yield key.promiseSign(exports.getNotificationData({ seq, nonce }));
            const publisher = buildResource.permalink(identity);
            try {
                yield utils_1.post(`${this.serverUrl}/notification`, {
                    publisher,
                    subscriber,
                    seq,
                    nonce,
                    sig
                });
            }
            catch (error) {
                yield this.saveError({ subscriber, error });
                throw error;
            }
        });
        this.registration = conf.sub(':reg');
        this.subscribers = conf.sub(':sub');
        this.serverUrl = serverUrl;
        this.cache = new Cache({ max: 1 });
        this.logger = logger;
        this.ensureRegistered = utils_1.cachifyFunction(this, 'ensureRegistered');
    }
}
exports.default = Push;
exports.Push = Push;
//# sourceMappingURL=push.js.map