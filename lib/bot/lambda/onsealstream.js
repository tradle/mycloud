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
const _ = require("lodash");
const db_utils_1 = require("../../db-utils");
const utils_1 = require("../../utils");
const lambda_1 = require("../lambda");
const Read = {
    one: 'readseal',
    batch: 'readseals'
};
const Write = {
    one: 'wroteseal',
    batch: 'wroteseals'
};
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromDynamoDB(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { bot } = lambda;
    const { batchSize = 10 } = opts;
    const processBatch = (records) => __awaiter(this, void 0, void 0, function* () {
        const events = records.map(recordToEvent);
        const [read, wrote] = splitReadWrite(events);
        yield Promise.all([
            read.map(({ data }) => bot.hooks.fire(Read.batch, data)),
            wrote.map(({ data }) => bot.hooks.fire(Write.batch, data))
        ]);
        yield Promise.all(events.map(({ event, data }) => {
            return bot.hooks.fire(event, data);
        }));
    });
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const data = db_utils_1.getRecordsFromEvent(ctx.event, true);
        yield utils_1.batchProcess({ data, batchSize, processBatch });
        yield next();
    });
};
const recordToEvent = record => ({
    event: recordToEventType(record),
    data: record.new
});
const recordToEventType = record => {
    const wasJustSealed = (!record.old || record.old.unsealed) && !record.new.unsealed;
    if (wasJustSealed)
        return Write.one;
    return Read.one;
};
const splitReadWrite = events => _.partition(events, ({ event }) => event === Read.one);
//# sourceMappingURL=onsealstream.js.map