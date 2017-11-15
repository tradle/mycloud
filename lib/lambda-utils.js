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
                Payload: JSON.stringify({
                    requestContext: this.env.getRequestContext(),
                    payload: arg
                })
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
            this.logger.debug(`looking up configuration for ${FunctionName}`);
            return this.aws.lambda.getFunctionConfiguration({ FunctionName }).promise();
        };
        this.getStackResources = (StackName) => __awaiter(this, void 0, void 0, function* () {
            if (!StackName) {
                StackName = this.getStackName();
            }
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
        this.listFunctions = (StackName) => __awaiter(this, void 0, void 0, function* () {
            if (!StackName) {
                StackName = this.getStackName();
            }
            let all = [];
            let Marker;
            let opts = {};
            while (true) {
                let { NextMarker, Functions } = yield this.aws.lambda.listFunctions(opts).promise();
                all = all.concat(Functions);
                if (!NextMarker)
                    break;
                opts.Marker = NextMarker;
            }
            return all;
        });
        this.listStackFunctions = (StackName) => __awaiter(this, void 0, void 0, function* () {
            const resources = yield this.getStackResources(StackName);
            const lambdaNames = [];
            for (const { ResourceType, PhysicalResourceId } of resources) {
                if (ResourceType === 'AWS::Lambda::Function' && PhysicalResourceId) {
                    lambdaNames.push(PhysicalResourceId);
                }
            }
            return lambdaNames;
        });
        this.getStackFunctionConfigurations = (StackName) => __awaiter(this, void 0, void 0, function* () {
            const [names, configs] = yield Promise.all([
                this.listStackFunctions(),
                this.listFunctions()
            ]);
            return configs.filter(({ FunctionName }) => names.includes(FunctionName));
        });
        this.updateEnvironments = (map) => __awaiter(this, void 0, void 0, function* () {
            const functions = yield this.getStackFunctionConfigurations();
            if (!functions)
                return;
            const writes = functions.map(current => {
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
                this.logger.debug(`not updating "${functionName}", no new environment variables`);
                return;
            }
            this.logger.debug(`updating "${functionName}" with new environment variables`);
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
                this.logger.debug(`invoking ${params.FunctionName} inside ${this.env.FUNCTION_NAME}`);
                return yield this._requireAndInvoke(params);
            }
            this.logger.debug(`invoking ${params.FunctionName}`);
            return yield this.aws.lambda.invoke(params).promise();
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
        this.logger = env.sublogger('lambda-utils');
    }
    get thisFunctionName() {
        return this.env.AWS_LAMBDA_FUNCTION_NAME;
    }
    getStackName() {
        return this.env.STACK_ID;
    }
}
exports.default = Utils;
//# sourceMappingURL=lambda-utils.js.map