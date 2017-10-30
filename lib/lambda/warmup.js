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
process.env.LAMBDA_BIRTH_DATE = Date.now();
const AWS = require("aws-sdk");
const constants_1 = require("../constants");
const { SERVERLESS_PREFIX, SERVERLESS_ALIAS = '$LATEST' } = process.env;
const lambda = new AWS.Lambda();
const commonParams = {
    InvocationType: 'RequestResponse',
    LogType: 'None',
    Qualifier: SERVERLESS_ALIAS,
    Payload: JSON.stringify({
        source: constants_1.WARMUP_SOURCE_NAME
    })
};
function handler(event, context, callback) {
    return __awaiter(this, void 0, void 0, function* () {
        const { functions } = event;
        const defaultConcurrency = event.concurrency || 1;
        let invokes = [];
        let errors = 0;
        console.log('Warm Up Start');
        yield Promise.all(functions.map((warmUpConf) => __awaiter(this, void 0, void 0, function* () {
            warmUpConf = normalizeWarmUpConf(warmUpConf);
            const { functionName, concurrency = defaultConcurrency } = warmUpConf;
            const params = Object.assign({}, commonParams, { FunctionName: `${SERVERLESS_PREFIX}${functionName}` });
            console.log(`Attempting to warm up ${concurrency} instances of ${functionName}`);
            yield Promise.all(new Array(concurrency).fill(0).map(() => __awaiter(this, void 0, void 0, function* () {
                try {
                    const resp = yield lambda.invoke(params).promise();
                    console.log(`Warm Up Invoke Success: ${functionName}`, resp);
                }
                catch (err) {
                    errors++;
                    console.log(`Warm Up Invoke Error: ${functionName}`, err.stack);
                }
            })));
        })));
        console.log(`Warm Up Finished with ${errors} invoke errors`);
        callback();
    });
}
exports.handler = handler;
const normalizeWarmUpConf = warmUpConf => {
    if (typeof warmUpConf === 'string') {
        return { functionName: warmUpConf };
    }
    let functionName;
    for (let p in warmUpConf) {
        functionName = p;
        break;
    }
    return {
        functionName,
        concurrency: warmUpConf[functionName].concurrency
    };
};
//# sourceMappingURL=warmup.js.map