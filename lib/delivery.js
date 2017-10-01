"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const events_1 = require("events");
const DeliveryMQTT = require("./delivery-mqtt");
const delivery_http_1 = require("./delivery-http");
const utils_1 = require("./utils");
const debug = require('debug')('tradle:sls:delivery');
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
    constructor(opts) {
        super();
        this._deliverBatch = withTransport('deliverBatch');
        this.ack = withTransport('ack');
        this.reject = withTransport('reject');
        this.deliverBatch = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { messages } = opts;
            messages.forEach(object => this.objects.presignEmbeddedMediaLinks({ object }));
            return this._deliverBatch(opts);
        });
        const { friends, messages, objects } = opts;
        this.messages = messages;
        this.objects = objects;
        this.friends = friends;
        this.http = new delivery_http_1.default(opts);
        this.mqtt = new DeliveryMQTT(opts);
    }
    deliverMessages(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            opts = utils_1.clone(opts);
            let { recipient, gt = 0, lt = Infinity, afterMessage } = opts;
            debug(`looking up messages for ${recipient} > ${gt}`);
            while (true) {
                let batchSize = Math.min(lt - gt - 1, MAX_BATCH_SIZE);
                if (batchSize <= 0)
                    return;
                let messages = yield this.messages.getMessagesTo({
                    recipient,
                    gt,
                    afterMessage,
                    limit: batchSize,
                    body: true,
                });
                debug(`found ${messages.length} messages for ${recipient}`);
                if (!messages.length)
                    return;
                yield this.deliverBatch(Object.assign({}, opts, { messages }));
                let last = messages[messages.length - 1];
                afterMessage = utils_1.pick(last, ['_recipient', 'time']);
            }
        });
    }
    getTransport(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const { method, recipient, clientId, friend } = opts;
            if (clientId || !(method in this.http)) {
                return this.mqtt;
            }
            if (friend || !(method in this.mqtt)) {
                return this.http;
            }
            try {
                opts.friend = yield this.friends.get({ permalink: recipient });
                return this.http;
            }
            catch (err) {
                debug(`cannot determine transport to use for recipient ${recipient}`);
                throw err;
            }
        });
    }
}
module.exports = Delivery;
//# sourceMappingURL=delivery.js.map