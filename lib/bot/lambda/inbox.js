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
const compose = require("koa-compose");
const cors = require("kcors");
const body_parser_1 = require("../middleware/body-parser");
const lambda_1 = require("../lambda");
const inbox_1 = require("../middleware/inbox");
const onmessage_1 = require("../middleware/onmessage");
const onmessagessaved_1 = require("../middleware/onmessagessaved");
const MODELS_PACK = 'tradle.ModelsPack';
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromHTTP(opts);
    const { bot } = lambda;
    lambda.tasks.add({
        name: 'getiotendpoint',
        promiser: bot.iot.getEndpoint
    });
    bot.hook('message', ({ type, payload }) => __awaiter(this, void 0, void 0, function* () {
        if (type === MODELS_PACK) {
            yield bot.modelStore.saveModelsPack(payload);
        }
    }));
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    return compose([
        cors(),
        body_parser_1.bodyParser({ jsonLimit: '10mb' }),
        inbox_1.onMessage(lambda, opts),
        onmessage_1.onMessage(lambda, {
            onSuccess: inbox_1.createSuccessHandler(lambda, opts),
            onError: inbox_1.createErrorHandler(lambda, opts)
        }),
        onmessagessaved_1.onMessagesSaved(lambda, opts)
    ]);
};
//# sourceMappingURL=inbox.js.map