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
const querystring = require("querystring");
const lambda_1 = require("../lambda");
const utils_1 = require("../../utils");
const FAUCET_URL = `https://tbtcfaucet.tradle.io/withdraw`;
const DEFAULT_NUM_OUTPUTS = 2;
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromSchedule(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts = {}) => {
    const { numOutputs = DEFAULT_NUM_OUTPUTS } = opts;
    const { bot, logger } = lambda;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { amount } = ctx.event;
        const identity = yield bot.getMyIdentity();
        const address = identity.pubkeys.find(key => {
            return key.networkName === 'testnet' && key.purpose === 'messaging';
        }).fingerprint;
        const qs = querystring.stringify({
            amount: Math.floor(amount / numOutputs),
            address
        }) + '&';
        try {
            ctx.body = yield utils_1.get(`${FAUCET_URL}?${qs.repeat(numOutputs)}`);
        }
        catch (err) {
            ctx.status = 500;
            ctx.body = {
                message: err.message
            };
            return;
        }
        yield next();
    });
};
//# sourceMappingURL=recharge-bitcoin.js.map