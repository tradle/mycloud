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
const serverlessYml = require("../../cli/serverless-yml");
const lambda_1 = require("../lambda");
exports.createLambda = (opts) => {
    const lambda = lambda_1.fromLambda(opts);
    return lambda.use(exports.createMiddleware(lambda, opts));
};
exports.createMiddleware = (lambda, opts) => {
    const { logger, tradle } = lambda;
    const { lambdaUtils } = tradle;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { event } = ctx;
        logger.debug('reinitializing lambda containers', event);
        yield lambdaUtils.forceReinitializeContainers(event.functions);
        yield lambdaUtils.warmUp(lambdaUtils.getWarmUpInfo(serverlessYml).input);
        yield next();
    });
};
//# sourceMappingURL=reinitialize-containers.js.map