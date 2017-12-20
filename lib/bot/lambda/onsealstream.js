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
const db_utils_1 = require("../../db-utils");
const utils_1 = require("../../utils");
const lambda_1 = require("../../lambda");
exports.createLambda = (opts) => {
    const lambda = opts.bot.createLambda(Object.assign({ source: lambda_1.EventSource.DYNAMODB }, opts));
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { bot } = lambda;
    const { batchSize = 10 } = opts;
    const processOne = (record) => __awaiter(this, void 0, void 0, function* () {
        let sealEvent;
        const wasJustSealed = (!record.old || record.old.unsealed) && !record.new.unsealed;
        if (wasJustSealed) {
            sealEvent = 'wroteseal';
        }
        else {
            sealEvent = 'readseal';
        }
        yield bot.hooks.fire(sealEvent, record.new);
    });
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { event } = ctx;
        const records = db_utils_1.getRecordsFromEvent(event, true);
        yield utils_1.batchProcess({
            data: records,
            batchSize,
            processOne
        });
        yield next();
    });
};
//# sourceMappingURL=onsealstream.js.map