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
const utils_1 = require("./utils");
const FETCH_TIMEOUT = 10000;
class Delivery extends events_1.EventEmitter {
    constructor(opts) {
        super();
        this.ack = utils_1.promiseNoop;
        this.reject = (opts) => Promise.reject(opts.reason);
        this.deliverBatch = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { friend, messages } = opts;
            const endpoint = `${friend.url}/inbox`;
            return yield utils_1.tryUntilTimeRunsOut(() => utils_1.post(endpoint, { messages }), {
                env: this.env,
                attemptTimeout: FETCH_TIMEOUT,
                onError: (err) => {
                    this.logger.error('failed to delivery messages', { stack: err.stack });
                }
            });
        });
        this.env = opts.env;
        this.logger = this.env.sublogger('delivery-http');
    }
}
exports.default = Delivery;
//# sourceMappingURL=delivery-http.js.map