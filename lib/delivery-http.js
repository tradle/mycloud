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
const debug = require('debug')('tradle:sls:delivery-http');
const { post, promiseNoop } = require('./utils');
class Delivery extends events_1.EventEmitter {
    constructor(opts) {
        super();
        this.ack = promiseNoop;
        this.reject = (opts) => Promise.reject(opts.reason);
        this.deliverBatch = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { friend, messages } = opts;
            const endpoint = `${friend.url}/inbox`;
            yield post(endpoint, { messages });
        });
    }
}
module.exports = Delivery;
//# sourceMappingURL=delivery-http.js.map