"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rawAWS = require("aws-sdk");
const AWSXRay = require("aws-xray-sdk");
const aws_config_1 = require("./aws-config");
if (process.env._X_AMZN_TRACE_ID) {
    console.warn('capturing all http requests with AWSXRay');
    AWSXRay.captureHTTPsGlobal(require('http'));
}
function createAWSWrapper({ env, logger }) {
    const useXRay = env._X_AMZN_TRACE_ID;
    const AWS = useXRay
        ? AWSXRay.captureAWS(rawAWS)
        : rawAWS;
    AWS.config.correctClockSkew = true;
    const cacheServices = true;
    const services = aws_config_1.createConfig({ env });
    AWS.config.update(services);
    const instanceNameToServiceName = {
        s3: 'S3',
        dynamodb: 'DynamoDB',
        dynamodbStreams: 'DynamoDBStreams',
        docClient: 'DocumentClient',
        iot: 'Iot',
        sts: 'STS',
        kms: 'KMS',
        lambda: 'Lambda',
        iotData: 'Iot',
        cloudformation: 'CloudFormation'
    };
    const useGlobalConfigClock = service => {
        if (service instanceof AWS.DynamoDB.DocumentClient) {
            service = service.service;
        }
        if (!service.config)
            return;
        Object.defineProperty(service.config, 'systemClockOffset', {
            get() {
                return AWS.config.systemClockOffset;
            },
            set(value) {
                logger.warn(`setting systemClockOffset: ${value}`);
                AWS.config.systemClockOffset = value;
            }
        });
    };
    const api = (function () {
        const cachedServices = {};
        Object.keys(instanceNameToServiceName).forEach(instanceName => {
            const serviceName = instanceNameToServiceName[instanceName];
            let service;
            Object.defineProperty(cachedServices, instanceName, {
                set: function (value) {
                    service = value;
                },
                get: function () {
                    if (!service || !cacheServices) {
                        const lServiceName = serviceName.toLowerCase();
                        const conf = services[lServiceName] || {};
                        if (instanceName === 'docClient') {
                            service = new AWS.DynamoDB.DocumentClient(services.dynamodb);
                        }
                        else if (instanceName === 'iotData') {
                            const { IOT_ENDPOINT } = env;
                            service = new AWS.IotData(Object.assign({ endpoint: IOT_ENDPOINT }, conf));
                        }
                        else {
                            service = new AWS[serviceName](conf);
                        }
                    }
                    useGlobalConfigClock(service);
                    return service;
                }
            });
        });
        return cachedServices;
    }());
    api.AWS = AWS;
    api.xray = AWSXRay;
    api.trace = (function () {
        let segment;
        return {
            start: function () {
                segment = AWSXRay.getSegment();
            },
            get: function () {
                return segment;
            }
        };
    }());
    return api;
}
exports.default = createAWSWrapper;
exports.createAWSWrapper = createAWSWrapper;
//# sourceMappingURL=aws.js.map