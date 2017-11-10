const debug = require('debug')('tradle:sls:deployment-bot');
const co = require('co').wrap;
const clone = require('clone');
const omit = require('object.omit');
const { parseStub } = require('@tradle/validate-resource').utils;
const { TYPE } = require('@tradle/constants');
const { prettify } = require('../string-utils');
const Buckets = require('../buckets');
const { getFaviconURL, getLogoDataURI } = require('../image-utils');
const utils = require('../utils');
const templateFileName = 'compiled-cloudformation-template.json';
const { SERVERLESS_STAGE, SERVERLESS_SERVICE_NAME, ORG_DOMAIN } = process.env;
const artifactDirectoryPrefix = `serverless/${SERVERLESS_SERVICE_NAME}/${SERVERLESS_STAGE}`;
const MIN_SCALE = 1;
const MAX_SCALE = 1;
const NAMESPACE = ORG_DOMAIN.split('.').reverse().join('.');
const CONFIG_FORM = `${NAMESPACE}.Configuration`;
const DEPLOYMENT_PRODUCT = `${NAMESPACE}.Deployment`;
const getBaseTemplate = (function () {
    let baseTemplate;
    if (process.env.IS_OFFLINE) {
        baseTemplate = require('../cli/cloudformation-template');
        return () => Promise.resolve(baseTemplate);
    }
    return co(function* ({ s3, resources }) {
        const { ServerlessDeployment } = resources.buckets;
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
    parameters = clone(parameters);
    let scale = Math.round(parameters.scale);
    if (scale < MIN_SCALE)
        scale = MIN_SCALE;
    if (scale > MAX_SCALE)
        scale = MAX_SCALE;
    parameters.scale = scale;
    return parameters;
}
const writeTemplate = co(function* ({ s3, resources, parameters }) {
    const template = yield getBaseTemplate({ s3, resources });
    const customized = generateTemplate({ resources, template, parameters });
    const templateKey = `templates/scale-${parameters.scale}.json`;
    const { PublicConf } = resources.buckets;
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
const onForm = co(function* ({ bot, user, type, wrapper, currentApplication }) {
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
const onFormsCollected = co(function* ({ bot, user, application }) {
    if (application.requestFor !== DEPLOYMENT_PRODUCT)
        return;
    const latest = application.forms.slice().reverse().find(stub => {
        return parseStub(stub).type === CONFIG_FORM;
    });
    const form = yield bot.objects.get(parseStub(latest).link);
    const parameters = normalizeParameters(form);
    const templateKey = yield writeTemplate({
        s3: bot.aws.s3,
        resources: bot.resources,
        parameters
    });
    const { PublicConf } = bot.resources.buckets;
    const templateURL = `https://${PublicConf.id}.s3.amazonaws.com/${templateKey}`;
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
function getLambdaEnv(lambda) {
    return lambda.Properties.Environment.Variables;
}
function generateTemplate({ resources, template, parameters }) {
    const { name, scale, domain } = parameters;
    template.Description = `MyCloud, by Tradle`;
    const namespace = domain.split('.').reverse().join('.');
    const { Resources } = template;
    getLambdaEnv(Resources.BotUnderscoreonmessageLambdaFunction).PRODUCTS = [
        `tradle.WealthManagementAccount`,
        `cp.tradle.CorporateAccount`
    ].join(',');
    const deploymentBucketId = resources.buckets.ServerlessDeployment.id;
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
                let lEnv = getLambdaEnv(Resource);
                lEnv.ORG_NAME = name;
                lEnv.ORG_DOMAIN = domain;
                delete lEnv.ORG_LOGO;
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
module.exports = {
    onFormsCollected
};
//# sourceMappingURL=deployment-handlers.js.map