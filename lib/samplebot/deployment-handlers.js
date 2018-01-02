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
const lodash_1 = require("lodash");
const debug = require('debug')('tradle:sls:deployment-bot');
const { parseStub } = require('@tradle/validate-resource').utils;
const { TYPE } = require('@tradle/constants');
const { prettify } = require('../string-utils');
const { getFaviconURL, getLogoDataURI } = require('./image-utils');
const utils = require('../utils');
const templateFileName = 'compiled-cloudformation-template.json';
const MIN_SCALE = 1;
const MAX_SCALE = 1;
const CONFIG_FORM = 'tradle.deploy.Configuration';
const DEPLOYMENT_PRODUCT = 'tradle.deploy.Deployment';
exports.createDeploymentHandlers = ({ bot }) => {
    const { SERVERLESS_STAGE, SERVERLESS_SERVICE_NAME } = bot.env;
    const artifactDirectoryPrefix = `serverless/${SERVERLESS_SERVICE_NAME}/${SERVERLESS_STAGE}`;
    const getBaseTemplate = (function () {
        let baseTemplate;
        if (process.env.IS_OFFLINE || process.env.IS_LOCAL) {
            baseTemplate = require('../../.serverless/cloudformation-template-update-stack');
            return () => __awaiter(this, void 0, void 0, function* () { return baseTemplate; });
        }
        return ({ s3, buckets }) => __awaiter(this, void 0, void 0, function* () {
            const { ServerlessDeployment } = buckets;
            if (!baseTemplate) {
                const objects = yield s3.listObjects({
                    Bucket: ServerlessDeployment.id,
                    Prefix: artifactDirectoryPrefix
                }).promise();
                const templates = objects.Contents
                    .filter(object => object.Key.endsWith(templateFileName));
                const metadata = latestS3Object(templates);
                if (!metadata) {
                    debug('base template not found', prettify(objects));
                    return;
                }
                baseTemplate = yield ServerlessDeployment.getJSON(metadata.Key);
            }
            return baseTemplate;
        });
    }());
    function normalizeParameters(parameters) {
        parameters = lodash_1.cloneDeep(parameters);
        let scale = Math.round(parameters.scale);
        if (scale < MIN_SCALE)
            scale = MIN_SCALE;
        if (scale > MAX_SCALE)
            scale = MAX_SCALE;
        parameters.scale = scale;
        return parameters;
    }
    const writeTemplate = ({ s3, buckets, parameters }) => __awaiter(this, void 0, void 0, function* () {
        const template = yield getBaseTemplate({ s3, buckets });
        const customized = generateTemplate({ buckets, template, parameters });
        const templateKey = `templates/scale-${parameters.scale}.json`;
        const { PublicConf } = buckets;
        try {
            yield s3.putObject({
                Bucket: PublicConf.id,
                Key: templateKey,
                Body: JSON.stringify(customized),
                ACL: 'public-read'
            })
                .promise();
        }
        catch (err) {
            debug('failed to save template', err.stack);
        }
        return templateKey;
    });
    const onForm = ({ bot, user, type, wrapper, currentApplication }) => __awaiter(this, void 0, void 0, function* () {
        if (type !== CONFIG_FORM)
            return;
        if (!currentApplication || currentApplication.requestFor !== DEPLOYMENT_PRODUCT)
            return;
        const { object } = wrapper.payload;
        const { domain } = object;
        try {
            yield getLogoDataURI(domain);
        }
        catch (err) {
            const message = `couldn't process your logo!`;
            yield bot.requestEdit({
                user,
                object,
                message,
                errors: [
                    {
                        name: 'domain',
                        error: message
                    }
                ]
            });
        }
    });
    const onFormsCollected = ({ user, application }) => __awaiter(this, void 0, void 0, function* () {
        if (application.requestFor !== DEPLOYMENT_PRODUCT)
            return;
        const latest = application.forms.slice().reverse().find(stub => {
            return parseStub(stub).type === CONFIG_FORM;
        });
        const form = yield bot.objects.get(parseStub(latest).link);
        const parameters = normalizeParameters(form);
        const templateKey = yield writeTemplate({
            s3: bot.aws.s3,
            buckets: bot.buckets,
            parameters
        });
        const { PublicConf } = bot.buckets;
        const templateURL = PublicConf.getUrlForKey(templateKey);
        const launchURL = utils.launchStackUrl({
            stackName: 'tradle',
            templateURL
        });
        debug(`Launch your stack: ${launchURL}`);
        yield bot.send({
            to: user.id,
            object: {
                [TYPE]: 'tradle.SimpleMessage',
                message: `**[Launch MyCloud](${launchURL})**`
            }
        });
    });
    return {
        onFormsCollected
    };
};
function getLambdaEnv(lambda) {
    return lambda.Properties.Environment.Variables;
}
function generateTemplate({ buckets, template, parameters }) {
    const { name, scale, domain } = parameters;
    template.Description = `MyCloud, by Tradle`;
    const namespace = domain.split('.').reverse().join('.');
    const { Resources } = template;
    Resources.Initialize.Properties.ProviderConf.private.org = { name, domain };
    const deploymentBucketId = buckets.ServerlessDeployment.id;
    for (let key in Resources) {
        let Resource = Resources[key];
        let { Type } = Resource;
        switch (Type) {
            case 'AWS::DynamoDB::Table':
                debug(`scaling ${Type} ${Resource.Properties.TableName}`);
                scaleTable({ table: Resource, scale });
                break;
            case 'AWS::Lambda::Function':
                Resource.Properties.Code.S3Bucket = deploymentBucketId;
                break;
            default:
                break;
        }
    }
    return template;
}
function scaleTable({ table, scale }) {
    let { ProvisionedThroughput } = table.Properties;
    ProvisionedThroughput.ReadCapacityUnits *= scale;
    ProvisionedThroughput.WriteCapacityUnits *= scale;
    const { GlobalSecondaryIndexes = [] } = table;
    GlobalSecondaryIndexes.forEach(index => scaleTable({ table: index, scale }));
}
function last(arr) {
    return arr[arr.length - 1];
}
function latestS3Object(list) {
    let max = 0;
    let latest;
    for (let metadata of list) {
        let date = new Date(metadata.LastModified).getTime();
        if (date > max)
            latest = metadata;
    }
    return latest;
}
//# sourceMappingURL=deployment-handlers.js.map