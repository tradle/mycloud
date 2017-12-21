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
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromDynamoDB(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { events } = lambda.tradle;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { event } = ctx;
        const results = events.fromStreamEvent(event);
        if (results.length) {
            ctx.events = yield events.putEvents(results);
        }
        else {
            ctx.events = results;
        }
        yield next();
    });
};
//# sourceMappingURL=to-events.js.map