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
const fs = require("fs");
const mkdirp = require("mkdirp");
const Debug = require("debug");
const debug = Debug('tradle:sls:discovery');
const pfs = utils_1.promisify(fs);
const pmkdirp = utils_1.promisify(mkdirp);
class Discovery {
    constructor(opts) {
        this.getServiceDiscoveryFunctionName = () => {
            const { thisFunctionName } = this;
            if (thisFunctionName) {
                const parts = thisFunctionName.split('-');
                parts[parts.length - 1] = 'setenvvars';
                return parts.join('-');
            }
            const { SERVERLESS_STAGE, SERVERLESS_SERVICE_NAME } = this.env;
            return `${SERVERLESS_SERVICE_NAME}-${SERVERLESS_STAGE}-setenvvars`;
        };
        this.discoverServices = (StackName) => __awaiter(this, void 0, void 0, function* () {
            const { thisFunctionName } = this;
            let env;
            if (thisFunctionName && thisFunctionName.endsWith('-setenvvars')) {
                env = yield this.doDiscoverServices(StackName);
            }
            else {
                debug('delegating service discovery');
                env = yield this.lambdaUtils.invoke({
                    name: this.getServiceDiscoveryFunctionName(),
                    sync: true
                });
                debug('received env', env);
            }
            return env;
        });
        this.doDiscoverServices = (StackName) => __awaiter(this, void 0, void 0, function* () {
            debug('performing service discovery');
            const { thisFunctionName } = this;
            const promiseIotEndpoint = this.iot.getEndpoint();
            let thisFunctionConfig;
            if (!StackName) {
                thisFunctionConfig = yield this.lambdaUtils.getConfiguration(thisFunctionName);
                StackName = thisFunctionConfig.Description;
                if (!StackName.startsWith('arn:aws:cloudformation')) {
                    throw new Error(`expected function ${thisFunctionName} Description to contain Ref: StackId`);
                }
            }
            const { StackResourceSummaries } = yield this.lambdaUtils.getStack(StackName);
            const env = {
                IOT_ENDPOINT: yield promiseIotEndpoint
            };
            const willWrite = StackResourceSummaries.every(({ ResourceStatus }) => {
                return ResourceStatus === 'CREATE_COMPLETE' ||
                    ResourceStatus === 'UPDATE_COMPLETE';
            });
            if (willWrite) {
                debug('setting environment variables for lambdas');
                const functions = StackResourceSummaries.filter(isLambda);
                yield Promise.all(functions.map(({ PhysicalResourceId }) => {
                    let current;
                    if (PhysicalResourceId === thisFunctionName) {
                        current = thisFunctionConfig;
                    }
                    debug(`updating environment variables for: ${PhysicalResourceId}`);
                    return this.lambdaUtils.updateEnvironment({
                        functionName: PhysicalResourceId,
                        update: env,
                        current
                    });
                }));
                if (process.env.IS_LOCAL) {
                    yield this.saveToLocalFS(env);
                }
            }
            return env;
        });
        this.saveToLocalFS = (vars) => __awaiter(this, void 0, void 0, function* () {
            const { RESOURCES_ENV_PATH } = this.env;
            try {
                yield pmkdirp(path.dirname(RESOURCES_ENV_PATH));
                yield pfs.writeFile(RESOURCES_ENV_PATH, JSON.stringify(vars, null, 2));
            }
            catch (err) {
                debug('failed to write environment');
            }
        });
        const { env, aws, lambdaUtils, iot } = opts;
        this.env = env;
        this.aws = aws;
        this.lambdaUtils = lambdaUtils;
        this.iot = iot;
    }
    get thisFunctionName() {
        return this.lambdaUtils.thisFunctionName;
    }
}
exports.default = Discovery;
function isLambda(summary) {
    return summary.ResourceType === 'AWS::Lambda::Function';
}
//# sourceMappingURL=discovery.js.map