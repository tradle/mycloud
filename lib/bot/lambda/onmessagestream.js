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
const constants_1 = require("@tradle/constants");
const lambda_1 = require("../lambda");
const onmessagestream_1 = require("../middleware/onmessagestream");
const MODELS_PACK = 'tradle.ModelsPack';
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromDynamoDB(opts);
    const { bot, tradle, logger, tasks } = lambda;
    tasks.add({
        name: 'getiotendpoint',
        promiser: bot.iot.getEndpoint
    });
    bot.hook('message', ({ user, payload }) => __awaiter(this, void 0, void 0, function* () {
        if (user.friend && payload[constants_1.TYPE] === MODELS_PACK) {
            try {
                yield tradle.modelStore.updateCumulativeModelsPackWithPack(payload);
            }
            catch (err) {
                logger.error(err.message, { pack: payload });
                return false;
            }
        }
    }));
    return lambda.use(onmessagestream_1.createMiddleware(lambda, opts));
};
//# sourceMappingURL=onmessagestream.js.map