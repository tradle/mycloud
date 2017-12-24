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
const lambda_1 = require("../lambda");
const MAX_WITHDRAWAL_SATOSHIS = 1e7;
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromSchedule(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts = {}) => {
    const { logger, tradle } = lambda;
    const { faucet } = tradle;
    const { maxWithdrawal = MAX_WITHDRAWAL_SATOSHIS } = opts;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { to, fee } = ctx.event;
        const total = to.reduce((total, next) => total + next.amount, 0);
        if (total > maxWithdrawal) {
            throw new Error(`the limit per withdrawal is ${maxWithdrawal} satoshis`);
        }
        logger.info(`sending ${total} satoshis to ${to}`);
        ctx.body = yield faucet.withdraw({ to, fee });
        yield next();
    });
};
//# sourceMappingURL=faucet-bitcoin.js.map