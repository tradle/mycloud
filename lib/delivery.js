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
const DeliveryMQTT = require("./delivery-mqtt");
const delivery_http_1 = require("./delivery-http");
const utils_1 = require("./utils");
const errors_1 = require("./errors");
const MIN_BATCH_DELIVERY_TIME = 2000;
const MAX_BATCH_SIZE = 5;
function normalizeOpts(opts) {
    if (!opts.recipient && opts.message) {
        opts.recipient = opts.message._author;
    }
    return opts;
}
function withTransport(method) {
    return function (opts) {
        return __awaiter(this, void 0, void 0, function* () {
            opts = normalizeOpts(Object.assign({}, opts, { method }));
            const transport = yield this.getTransport(opts);
            return transport[method](opts);
        });
    };
}
class Delivery extends events_1.EventEmitter {
    constructor(tradle) {
        super();
        this.ack = withTransport('ack');
        this.reject = withTransport('reject');
        this._deliverBatch = withTransport('deliverBatch');
        this.deliverBatch = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { messages } = opts;
            messages.forEach(object => this.objects.presignEmbeddedMediaLinks({ object }));
            return this._deliverBatch(opts);
        });
        this.deliverMessages = ({ recipient, clientId, friend, range, batchSize = MAX_BATCH_SIZE }) => __awaiter(this, void 0, void 0, function* () {
            let { afterMessage } = range;
            const { before, after } = range;
            this.logger.debug(`looking up messages for ${recipient} > ${after}`);
            const result = {
                finished: false,
                range: Object.assign({}, range)
            };
            while (true) {
                let messages = yield this.messages.getMessagesTo({
                    recipient,
                    gt: after,
                    afterMessage,
                    limit: batchSize,
                    body: true,
                });
                this.logger.debug(`found ${messages.length} messages for ${recipient}`);
                if (!messages.length) {
                    result.finished = true;
                    break;
                }
                if (this.env.getRemainingTime() < MIN_BATCH_DELIVERY_TIME) {
                    this.logger.info('delivery ran out of time');
                    break;
                }
                yield this.deliverBatch({ recipient, messages, clientId, friend });
                let last = messages[messages.length - 1];
                afterMessage = utils_1.pick(last, ['_recipient', 'time']);
                result.range.afterMessage = afterMessage;
                delete result.range.after;
            }
            return result;
        });
        this.getTransport = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { method, recipient, clientId, friend } = opts;
            if (clientId || !(method in this.http)) {
                return this.mqtt;
            }
            if (friend || !(method in this.mqtt)) {
                return this.http;
            }
            try {
                opts.friend = yield this.friends.getByIdentityPermalink(recipient);
                return this.http;
            }
            catch (err) {
                this.logger.debug(`cannot determine transport to use for recipient ${recipient}`);
                throw new errors_1.ClientUnreachable(`${recipient} is unreachable for live delivery`);
            }
        });
        const { friends, messages, objects, env } = tradle;
        this.tradle = tradle;
        this.messages = messages;
        this.objects = objects;
        this.friends = friends;
        this.http = new delivery_http_1.default(tradle);
        this.mqtt = new DeliveryMQTT(tradle);
        this.env = env;
        this.logger = this.env.sublogger('delivery');
    }
}
exports.default = Delivery;
//# sourceMappingURL=delivery.js.map