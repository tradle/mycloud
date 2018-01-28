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
const bot_1 = require("../../bot");
const lambda_1 = require("../../bot/lambda");
const customize_1 = require("../customize");
const bot = bot_1.createBot({ ready: false });
const lambda = lambda_1.fromCli({ bot });
const promiseComponents = customize_1.customize({ lambda, event: 'remediation:utils' });
lambda.use((ctx, next) => __awaiter(this, void 0, void 0, function* () {
    const { remediator } = yield promiseComponents;
    const { method, data } = ctx.event;
    ctx.body = yield run({ method, data, remediator });
}));
const run = ({ method, data, remediator }) => __awaiter(this, void 0, void 0, function* () {
    if (method === 'createbundle') {
        return {
            key: yield remediator.saveUnsignedDataBundle(data)
        };
    }
    if (method === 'createclaim') {
        return yield remediator.createClaim(data);
    }
    if (method === 'listclaims') {
        return yield remediator.listClaimsForBundle(data);
    }
    if (method === 'getbundle') {
        return yield remediator.getBundle(data);
    }
    if (method === 'clearclaims') {
        return yield remediator.deleteClaimsForBundle(data);
    }
    throw new Error(`unknown method "${method}"`);
});
exports.handler = lambda.handler;
//# sourceMappingURL=import-data-utils.js.map