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
const Errors = require("../../errors");
const notNull = val => !!val;
const promiseNoop = () => __awaiter(this, void 0, void 0, function* () { });
exports.onMessage = (lambda, opts) => {
    const { logger, tradle } = lambda;
    const { user } = tradle;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        let { messages } = ctx.event;
        if (!messages) {
            ctx.body = {
                message: 'invalid payload, expected {"messages":[]}'
            };
            ctx.status = 400;
            return;
        }
        yield next();
    });
};
exports.createSuccessHandler = (lambda, opts) => promiseNoop;
exports.createErrorHandler = (lambda, opts) => ({ message, error }) => __awaiter(this, void 0, void 0, function* () {
    Errors.ignore(error, Errors.Duplicate);
});
//# sourceMappingURL=inbox.js.map