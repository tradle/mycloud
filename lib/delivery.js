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
const DeliveryHTTP = require("./delivery-http");
const utils_1 = require("./utils");
const debug = require('debug')('tradle:sls:delivery');
const MAX_BATCH_SIZE = 5;
function withTransport(method) {
    return function (opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const transport = yield this.getTransport(Object.assign({}, opts, { method }));
            return transport[method](opts);
        });
    };
}
class Delivery extends events_1.EventEmitter {
    constructor(opts) {
        super();
        this.deliverBatch = withTransport('deliverBatch');
        this.ack = withTransport('ack');
        this.reject = withTransport('reject');
        const { friends, messages } = opts;
        this.messages = messages;
        this.friends = friends;
        this.http = new DeliveryHTTP(opts);
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
                yield this.deliverBatch(utils_1.clone(opts, { messages }));
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
                if (err.name !== 'NotFound') {
                    throw err;
                }
                return this.mqtt;
            }
        });
    }
}
module.exports = Delivery;
//# sourceMappingURL=delivery.js.map