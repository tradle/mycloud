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
class Discovery {
    constructor(opts) {
        this.getServiceDiscoveryFunctionName = () => {
            return this.env.SERVERLESS_PREFIX + 'setenvvars';
        };
        this.discoverServices = (StackName) => __awaiter(this, void 0, void 0, function* () {
            const { thisFunctionName } = this;
            let env;
            if (thisFunctionName && thisFunctionName.endsWith('-setenvvars')) {
                env = yield this.doDiscoverServices(StackName);
            }
            else {
                this.logger.info('delegating service discovery');
                env = yield this.lambdaUtils.invoke({
                    name: this.getServiceDiscoveryFunctionName(),
                    sync: true
                });
                this.logger.debug('received env', env);
            }
            return env;
        });
        this.doDiscoverServices = (StackName) => __awaiter(this, void 0, void 0, function* () {
            const { thisFunctionName } = this;
            this.logger.debug(`performing service discovery in function ${thisFunctionName}`);
            const promiseIotEndpoint = this.iot.getEndpoint();
            let thisFunctionConfig;
            if (!StackName) {
                thisFunctionConfig = yield this.lambdaUtils.getConfiguration(thisFunctionName);
                StackName = thisFunctionConfig.Description;
                if (!StackName.startsWith('arn:aws:cloudformation')) {
                    throw new Error(`expected function ${thisFunctionName} Description to contain Ref: StackId`);
                }
            }
            const resources = yield this.lambdaUtils.getStackResources(StackName);
            const env = {
                IOT_ENDPOINT: yield promiseIotEndpoint
            };
            const willWrite = resources.every(({ ResourceStatus }) => {
                return ResourceStatus === 'CREATE_COMPLETE' ||
                    ResourceStatus === 'UPDATE_COMPLETE';
            });
            if (willWrite) {
                this.logger.debug('setting environment variables for lambdas', JSON.stringify(env, null, 2));
                const functions = resources.filter(isLambda);
                this.logger.debug('will update functions', JSON.stringify(functions, null, 2));
                yield Promise.all(functions.map(({ PhysicalResourceId }) => __awaiter(this, void 0, void 0, function* () {
                    let current;
                    if (PhysicalResourceId === thisFunctionName) {
                        current = thisFunctionConfig;
                    }
                    this.logger.debug(`updating environment variables for: ${PhysicalResourceId}`);
                    return this.lambdaUtils.updateEnvironment({
                        functionName: PhysicalResourceId,
                        update: env,
                        current
                    });
                })));
            }
            return env;
        });
        const { env, aws, lambdaUtils, iot, logger } = opts;
        this.env = env;
        this.logger = logger.sub('discovery');
        this.aws = aws;
        this.lambdaUtils = lambdaUtils;
        this.iot = iot;
    }
    get thisFunctionName() {
        return this.lambdaUtils.thisFunctionName;
    }
}
exports.default = Discovery;
exports.Discovery = Discovery;
function isLambda(summary) {
    return summary.ResourceType === 'AWS::Lambda::Function';
}
//# sourceMappingURL=discovery.js.map