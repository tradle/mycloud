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
const constants_1 = require("./constants");
const PRICING = require("./lambda-pricing");
const defaultConcurrency = 1;
const notNull = (val) => !!val;
const RATE_REGEX = /^rate\((\d+)\s(minute|hour|day)s?\)$/;
exports.WARMUP_FUNCTION_SHORT_NAME = 'warmup';
exports.WARMUP_FUNCTION_DURATION = 5000;
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
            let { name, arg = {}, sync = true, log, local = this.env.IS_OFFLINE, qualifier, wrapPayload } = opts;
            const FunctionName = this.getFullName(name);
            if (wrapPayload !== false) {
                arg = {
                    requestContext: this.env.getRequestContext(),
                    payload: arg
                };
            }
            const params = {
                InvocationType: sync ? 'RequestResponse' : 'Event',
                FunctionName,
                Payload: JSON.stringify(arg)
            };
            if (log)
                params.LogType = 'Tail';
            if (qualifier)
                params.Qualifier = qualifier;
            this.logger.debug(`invoking ${params.FunctionName}`);
            let result;
            if (local) {
                result = yield this.invokeLocal(params);
            }
            else {
                result = yield this.aws.lambda.invoke(params).promise();
            }
            const { StatusCode, Payload, FunctionError } = result;
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
            if (this.env.TESTING) {
                this.logger.debug(`updateEnvironments is skipped in test mode`);
                return;
            }
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
            if (this.env.TESTING) {
                this.logger.debug(`updateEnvironment is skipped in test mode`);
                return;
            }
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
        this.forceReinitializeContainers = (functions) => __awaiter(this, void 0, void 0, function* () {
            yield this.updateEnvironments(({ FunctionName }) => {
                if (!functions || functions.includes(FunctionName)) {
                    return getDateUpdatedEnvironmentVariables();
                }
            });
        });
        this.forceReinitializeContainer = (functionName) => __awaiter(this, void 0, void 0, function* () {
            yield this.updateEnvironment({
                functionName,
                update: getDateUpdatedEnvironmentVariables()
            });
        });
        this.invokeLocal = (params) => __awaiter(this, void 0, void 0, function* () {
            const { FunctionName, InvocationType, Payload } = params;
            this.logger.debug(`invoking ${params.FunctionName} inside ${this.env.FUNCTION_NAME}`);
            const shortName = this.getShortName(FunctionName);
            const yml = require('./cli/serverless-yml');
            const { functions } = yml;
            const handlerExportPath = functions[shortName].handler;
            const lastDotIdx = handlerExportPath.lastIndexOf('.');
            const handlerPath = path.join('..', handlerExportPath.slice(0, lastDotIdx));
            const handleExportName = handlerExportPath.slice(lastDotIdx + 1);
            const handler = require(handlerPath)[handleExportName];
            const event = typeof Payload === 'string' ? JSON.parse(Payload) : {};
            const context = utils_1.createLambdaContext(FunctionName);
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
        this.parseRateExpression = rate => {
            const match = rate.match(RATE_REGEX);
            if (!match)
                throw new Error(`failed to parse rate expression: ${rate}`);
            const [val, unit] = match.slice(1);
            return Number(val) * constants_1.unitToMillis[unit];
        };
        this.normalizeWarmUpConf = warmUpConf => {
            if (typeof warmUpConf === 'string') {
                return {
                    functionName: warmUpConf
                };
            }
            let functionName;
            for (let p in warmUpConf) {
                functionName = p;
                break;
            }
            return {
                functionName,
                concurrency: warmUpConf[functionName].concurrency || defaultConcurrency
            };
        };
        this.getWarmUpInfo = (yml) => {
            const { service, functions, provider } = yml;
            const event = functions[exports.WARMUP_FUNCTION_SHORT_NAME].events.find(event => event.schedule);
            const { rate, input } = event.schedule;
            const period = this.parseRateExpression(rate);
            const warmUpConfs = input.functions.map(conf => this.normalizeWarmUpConf(conf));
            warmUpConfs.forEach(conf => {
                if (!(conf.functionName in functions)) {
                    throw new Error(`function ${conf.functionName} listed in warmup event does not exist`);
                }
            });
            return {
                period,
                input,
                warmUpConfs,
                functionName: exports.WARMUP_FUNCTION_SHORT_NAME
            };
        };
        this.estimateCost = (yml) => {
            const { provider, functions } = yml;
            const info = this.getWarmUpInfo(yml);
            const costPerFunction = {
                [info.functionName]: {
                    once: PRICING[getMemorySize(functions[exports.WARMUP_FUNCTION_SHORT_NAME], provider)] * exports.WARMUP_FUNCTION_DURATION
                }
            };
            const costs = {
                once: costPerFunction[info.functionName].once
            };
            for (let unit in constants_1.unitToMillis) {
                let once = costPerFunction[info.functionName].once;
                let fnCostPerPeriod = once * constants_1.unitToMillis[unit] / info.period;
                costPerFunction[info.functionName][unit] = fnCostPerPeriod;
                costs[unit] = fnCostPerPeriod;
            }
            for (const conf of info.warmUpConfs) {
                const { functionName, concurrency = info.input.concurrency } = conf;
                const memorySize = getMemorySize(functions[functionName], provider);
                costPerFunction[functionName] = {
                    once: PRICING[memorySize] * concurrency
                };
                costs.once += costPerFunction[functionName].once;
                for (let unit in constants_1.unitToMillis) {
                    let fnCostPerPeriod = costPerFunction[functionName].once * constants_1.unitToMillis[unit] / info.period;
                    costPerFunction[functionName][unit] = fnCostPerPeriod;
                    costs[unit] += fnCostPerPeriod;
                }
            }
            return {
                costs,
                costPerFunction,
                warmUpFunctionDuration: exports.WARMUP_FUNCTION_DURATION
            };
        };
        this.warmUp = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { concurrency = defaultConcurrency, functions } = opts;
            return yield Promise.all(functions.map(conf => {
                return this.warmUpFunction(Object.assign({ concurrency }, this.normalizeWarmUpConf(conf)));
            }));
        });
        this.warmUpFunction = (warmUpConf) => __awaiter(this, void 0, void 0, function* () {
            const { functionName, concurrency } = warmUpConf;
            const opts = {
                name: functionName,
                sync: true,
                qualifier: this.env.SERVERLESS_ALIAS || '$LATEST',
                arg: {
                    source: constants_1.WARMUP_SOURCE_NAME
                },
                wrapPayload: false
            };
            this.logger.info(`Attempting to warm up ${concurrency} instances of ${functionName}`);
            const fnResults = yield Promise.all(new Array(concurrency).fill(0).map(() => __awaiter(this, void 0, void 0, function* () {
                try {
                    const resp = yield this.invoke(opts);
                    this.logger.info(`Warm Up Invoke Success: ${functionName}`, resp);
                    return resp;
                }
                catch (err) {
                    this.logger.info(`Warm Up Invoke Error: ${functionName}`, err.stack);
                    return {
                        error: err.stack
                    };
                }
            })));
            const containers = {};
            return fnResults.reduce((summary, next) => {
                if (next.error) {
                    summary.errors++;
                    return summary;
                }
                if (next.isVirgin) {
                    summary.containersCreated++;
                }
                if (!containers[summary.containerId]) {
                    containers[summary.containerId] = true;
                    summary.containersWarmed++;
                }
                return summary;
            }, {
                functionName,
                containersCreated: 0,
                containersWarmed: 0
            });
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
const getDateUpdatedEnvironmentVariables = () => ({
    DATE_UPDATED: String(Date.now())
});
const getMemorySize = (conf, provider) => {
    return conf.memorySize || provider.memorySize || 128;
};
//# sourceMappingURL=lambda-utils.js.map