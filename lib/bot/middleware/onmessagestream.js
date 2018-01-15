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
const db_utils_1 = require("../../db-utils");
const utils_1 = require("../../utils");
const onmessagessaved_1 = require("./onmessagessaved");
const S3_GET_ATTEMPTS = 3;
const S3_FAILED_GET_INITIAL_RETRY_DELAY = 1000;
exports.createMiddleware = (lambda, opts) => {
    const { tradle, bot, logger } = lambda;
    const logAndThrow = (results) => {
        const failed = results.map(({ reason }) => reason)
            .filter(reason => reason);
        if (failed.length) {
            logger.debug('failed to save payloads', failed);
            throw new Error(failed[0]);
        }
    };
    const preProcess = exports.preProcessOne(lambda, opts);
    const postProcess = exports.postProcessOne(lambda, opts);
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { event } = ctx;
        event.bot = bot;
        const messages = db_utils_1.getRecordsFromEvent(event);
        const preResults = yield utils_1.batchProcess({
            data: messages,
            batchSize: 20,
            processOne: preProcess,
            settle: true
        });
        const successes = preResults
            .filter(result => result.value)
            .map(result => result.value);
        const postResults = yield utils_1.batchProcess({
            data: successes,
            batchSize: 20,
            processOne: postProcess
        });
        logAndThrow(preResults);
        yield next();
    });
};
exports.preProcessOne = (lambda, opts) => {
    const { bot, logger } = lambda;
    return (message) => __awaiter(this, void 0, void 0, function* () {
        const payload = message.object;
        const type = message._payloadType;
        let maxAttempts = S3_GET_ATTEMPTS;
        let delay = S3_FAILED_GET_INITIAL_RETRY_DELAY;
        while (maxAttempts--) {
            try {
                message.object = yield bot.objects.get(message.object._link);
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                yield utils_1.wait(delay);
                delay *= 2;
            }
        }
        return message;
    });
};
exports.postProcessOne = (lambda, opts) => {
    const { logger } = lambda;
    const businessLogicMiddleware = onmessagessaved_1.onMessagesSaved(lambda, opts);
    return (message) => __awaiter(this, void 0, void 0, function* () {
        const subCtx = Object.assign({}, lambda.execCtx, { event: message });
        try {
            yield businessLogicMiddleware(subCtx, utils_1.promiseNoop);
        }
        catch (err) {
            logger.debug('failure in custom onmessagestream middleware', {
                message: message,
                error: Errors.export(err)
            });
        }
    });
};
//# sourceMappingURL=onmessagestream.js.map