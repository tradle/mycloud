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
const path = require("path");
const utils_1 = require("./utils");
const notNull = (val) => !!val;
class Utils {
    constructor({ env, aws }) {
        this.getShortName = (name) => {
            return name.slice(this.env.SERVERLESS_PREFIX.length);
        };
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
            const { StatusCode, Payload, FunctionError } = yield this._invoke(params);
            if (FunctionError || (StatusCode && StatusCode >= 300)) {
                const message = Payload || `experienced ${FunctionError} error invoking lambda: ${name}`;
                throw new Error(message);
            }
            if (sync && Payload) {
                return JSON.parse(Payload);
            }
        });
        this.getConfiguration = (FunctionName) => {
            this.debug(`looking up configuration for ${FunctionName}`);
            return this.aws.lambda.getFunctionConfiguration({ FunctionName }).promise();
        };
        this.getStackResources = (StackName) => __awaiter(this, void 0, void 0, function* () {
            let resources = [];
            const opts = { StackName };
            while (true) {
                let { StackResourceSummaries, NextToken } = yield this.aws.cloudformation.listStackResources(opts).promise();
                resources = resources.concat(StackResourceSummaries);
                opts.NextToken = NextToken;
                if (!opts.NextToken)
                    break;
            }
            return resources;
        });
        this.listFunctions = () => {
            return this.aws.lambda.listFunctions().promise();
        };
        this.updateEnvironments = (map) => __awaiter(this, void 0, void 0, function* () {
            const { Functions } = yield this.listFunctions();
            if (!Functions)
                return;
            const writes = Functions.map(current => {
                const update = map(current);
                return update && {
                    current,
                    update
                };
            })
                .filter(notNull)
                .map(this.updateEnvironment);
            yield Promise.all(writes);
        });
        this.updateEnvironment = (opts) => __awaiter(this, void 0, void 0, function* () {
            let { functionName, update } = opts;
            let { current } = opts;
            if (!current) {
                if (!functionName)
                    throw new Error('expected "functionName"');
                current = yield this.getConfiguration(functionName);
            }
            functionName = current.FunctionName;
            const updated = {};
            const { Variables } = current.Environment;
            for (let key in update) {
                if (Variables[key] != update[key]) {
                    updated[key] = update[key];
                }
            }
            if (!Object.keys(updated).length) {
                this.debug(`not updating "${functionName}", no new environment variables`);
                return;
            }
            this.debug(`updating "${functionName}" with new environment variables`);
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
        this._invoke = (params) => __awaiter(this, void 0, void 0, function* () {
            if (this.env.IS_OFFLINE) {
                this.debug(`invoking ${params.FunctionName} inside ${this.env.FUNCTION_NAME}`);
                return yield this._requireAndInvoke(params);
            }
            else {
                this.debug(`invoking ${params.FunctionName}`);
                return yield this.aws.lambda.invoke(params).promise();
            }
        });
        this._requireAndInvoke = (params) => __awaiter(this, void 0, void 0, function* () {
            const { FunctionName, InvocationType, Payload } = params;
            const shortName = this.getShortName(FunctionName);
            const yml = require('./cli/serverless-yml');
            const createLambdaContext = require('serverless-offline/src/createLambdaContext');
            const { functions } = yml;
            const handlerExportPath = functions[shortName].handler;
            const lastDotIdx = handlerExportPath.lastIndexOf('.');
            const handlerPath = path.resolve(__dirname, '..', handlerExportPath.slice(0, lastDotIdx));
            const handleExportName = handlerExportPath.slice(lastDotIdx + 1);
            const handler = require(handlerPath)[handleExportName];
            const event = typeof Payload === 'string' ? JSON.parse(Payload) : {};
            const context = createLambdaContext(FunctionName);
            const result = {
                StatusCode: InvocationType === 'Event' ? 202 : 200,
                Payload: '',
                FunctionError: ''
            };
            try {
                const promise = utils_1.promisify(handler)(event, context, context.done);
                if (InvocationType === 'RequestResponse') {
                    const resp = yield promise;
                    result.Payload = JSON.stringify(resp);
                }
            }
            catch (err) {
                result.Payload = err.stack;
                result.FunctionError = err.stack;
                result.StatusCode = 400;
            }
            return result;
        });
        this.env = env;
        this.aws = aws;
        this.debug = env.logger('lambda-utils');
    }
    get thisFunctionName() {
        return this.env.AWS_LAMBDA_FUNCTION_NAME;
    }
}
exports.default = Utils;
//# sourceMappingURL=lambda-utils.js.map