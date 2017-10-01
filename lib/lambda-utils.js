"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const debug = require('debug')('tradls:sls:lambda-utils');
class Utils {
    constructor({ env, aws }) {
        this.getFullName = (name) => {
            const { SERVERLESS_PREFIX = '' } = this.env;
            return name.startsWith(SERVERLESS_PREFIX)
                ? name
                : `${SERVERLESS_PREFIX}${name}`;
        };
        this.invoke = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { name, arg = {}, sync = true, log } = opts;
            const FunctionName = this.getFullName(name);
            const params = {
                InvocationType: sync ? 'RequestResponse' : 'Event',
                FunctionName,
                Payload: typeof arg === 'string' ? arg : JSON.stringify(arg)
            };
            if (log)
                params.LogType = 'Tail';
            const { StatusCode, Payload, FunctionError } = yield this.aws.lambda.invoke(params).promise();
            if (StatusCode >= 300) {
                const message = Payload || `experienced ${FunctionError} error invoking lambda: ${name}`;
                throw new Error(message);
            }
            if (sync)
                return JSON.parse(Payload);
        });
        this.getConfiguration = (FunctionName) => {
            debug(`looking up configuration for ${FunctionName}`);
            return this.aws.lambda.getFunctionConfiguration({ FunctionName }).promise();
        };
        this.getStack = (StackName) => {
            return this.aws.cloudformation.listStackResources({ StackName }).promise();
        };
        this.listFunctions = () => {
            return this.aws.lambda.listFunctions().promise();
        };
        this.updateEnvironment = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { functionName, update } = opts;
            let { current } = opts;
            if (!current) {
                current = yield this.getConfiguration(functionName);
            }
            const updated = {};
            const { Variables } = current.Environment;
            for (let key in update) {
                if (Variables[key] !== update[key]) {
                    updated[key] = update[key];
                }
            }
            if (!Object.keys(updated).length) {
                debug(`not updating "${functionName}", no new environment variables`);
                return;
            }
            debug(`updating "${functionName}" with new environment variables`);
            for (let key in updated) {
                let val = updated[key];
                if (val == null) {
                    delete Variables[key];
                }
                else {
                    Variables[key] = val;
                }
            }
            yield this.aws.lambda.updateFunctionConfiguration({
                FunctionName: functionName,
                Environment: { Variables }
            }).promise();
        });
        this.env = env;
        this.aws = aws;
    }
    get thisFunctionName() {
        return this.env.AWS_LAMBDA_FUNCTION_NAME;
    }
}
module.exports = Utils;
//# sourceMappingURL=lambda-utils.js.map