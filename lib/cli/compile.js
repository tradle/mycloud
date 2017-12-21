"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { TYPE } = require('@tradle/constants');
const LOCALLY_AVAILABLE = [
    'AWS::DynamoDB::Table',
    'AWS::S3::Bucket',
    'AWS::ApiGateway::RestApi'
];
const { HTTP_METHODS, ENV_RESOURCE_PREFIX } = require('../constants');
function addBucketTables({ yml, prefix }) {
    const { resources, custom } = yml;
    const { tableBuckets } = custom;
    if (!tableBuckets)
        return;
    const { Resources } = resources;
    const { count, read, write, index } = tableBuckets;
    if (!custom.capacities)
        custom.capacities = [];
    const tables = Object.keys(Resources).filter(name => {
        return Resources[name].Type === 'AWS::DynamoDB::Table';
    });
    for (let i = 0; i < count; i++) {
        let name = `${prefix}bucket-${i}`;
        let def = getTableBucketDefinition({
            read,
            write,
            indexes: index,
            name,
            dependencies: tables
        });
        let logicalId = `BucketTable${i}`;
        Resources[logicalId] = def;
    }
    return yml;
}
exports.addBucketTables = addBucketTables;
function getTableBucketDefinition({ name, read, write, indexes, dependencies }) {
    return {
        Type: 'AWS::DynamoDB::Table',
        Description: `table that stores multiple models`,
        DependsOn: dependencies,
        Properties: {
            TableName: name,
            AttributeDefinitions: [
                {
                    AttributeName: '_tpermalink',
                    AttributeType: 'S'
                },
                {
                    AttributeName: '_t',
                    AttributeType: 'S'
                },
                {
                    AttributeName: '_author',
                    AttributeType: 'S'
                },
                {
                    AttributeName: '_time',
                    AttributeType: 'N'
                }
            ],
            KeySchema: [
                {
                    AttributeName: '_tpermalink',
                    KeyType: 'HASH'
                }
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: read.minimum,
                WriteCapacityUnits: write.minimum
            },
            GlobalSecondaryIndexes: indexes.map(index => ({
                IndexName: index === '_t' ? 'type' : index,
                KeySchema: [
                    {
                        AttributeName: index,
                        KeyType: 'HASH'
                    },
                    {
                        AttributeName: '_time',
                        KeyType: 'RANGE'
                    }
                ],
                Projection: {
                    ProjectionType: 'ALL'
                },
                ProvisionedThroughput: {
                    ReadCapacityUnits: read.minimum,
                    WriteCapacityUnits: write.minimum
                }
            }))
        }
    };
}
function forEachResource(yaml, fn) {
    const { resources, provider } = yaml;
    const { Resources } = resources;
    const { environment } = provider;
    let updated;
    for (let logicalId in Resources) {
        let resource = Resources[logicalId];
        if (logicalId === 'IamRoleLambdaExecution') {
            continue;
        }
        if (resource.Type.startsWith('Custom::')) {
            continue;
        }
        fn({
            id: logicalId,
            resource: Resources[logicalId]
        });
    }
}
exports.forEachResource = forEachResource;
function stripDevFunctions(yml) {
    const { functions } = yml;
    Object.keys(functions).forEach(name => {
        if (name.endsWith('_dev')) {
            delete functions[name];
        }
    });
}
exports.stripDevFunctions = stripDevFunctions;
function addResourcesToEnvironment(yaml) {
    const { provider, functions } = yaml;
    for (let fnName in functions) {
        addHTTPMethodsToEnvironment(functions[fnName]);
    }
    if (!provider.environment)
        provider.environment = {};
    const { environment } = provider;
    forEachResource(yaml, ({ id, resource }) => {
        if (id in environment) {
            throw new Error(`refusing to overwrite environment.${id}`);
        }
        const type = resource.Type.split('::').pop().toUpperCase();
        let shortName = id;
        if (id.toUpperCase().endsWith(type)) {
            shortName = shortName.slice(0, id.length - type.length);
        }
        environment[`${ENV_RESOURCE_PREFIX}${type}_${shortName}`] = {
            Ref: id
        };
    });
    environment.STACK_ID = {
        Ref: 'AWS::StackId'
    };
    environment[`${ENV_RESOURCE_PREFIX}RESTAPI_ApiGateway`] = {
        Ref: 'ApiGatewayRestApi'
    };
}
exports.addResourcesToEnvironment = addResourcesToEnvironment;
function addHTTPMethodsToEnvironment(conf) {
    if (!conf.events)
        return;
    const methods = conf.events.filter(e => e.http)
        .map(e => e.http.method.toUpperCase());
    if (!methods.length)
        return;
    if (!conf.environment) {
        conf.environment = {};
    }
    if (methods.length === 1 && methods[0] === 'ANY') {
        conf.environment.HTTP_METHODS = HTTP_METHODS;
    }
    else {
        conf.environment.HTTP_METHODS = methods
            .concat('OPTIONS')
            .join(',');
    }
}
exports.addHTTPMethodsToEnvironment = addHTTPMethodsToEnvironment;
function addResourcesToOutputs(yaml) {
    const { resources } = yaml;
    if (!resources.Outputs)
        resources.Outputs = {};
    const { Outputs } = resources;
    forEachResource(yaml, ({ id, resource }) => {
        if (id in Outputs) {
            throw new Error(`refusing to overwrite Outputs.${id}`);
        }
        const output = Outputs[id] = {};
        if (resource.Description) {
            output.Description = resource.Description;
        }
        output.Value = {
            Ref: id
        };
    });
}
exports.addResourcesToOutputs = addResourcesToOutputs;
function removeResourcesThatDontWorkLocally({ provider, resources }) {
    const { Resources } = resources;
    resources.Resources = {};
    Object.keys(Resources)
        .forEach(name => {
        const resource = Resources[name];
        if (LOCALLY_AVAILABLE.includes(resource.Type)) {
            resources.Resources[name] = resource;
        }
    });
    provider.iamRoleStatements = [];
}
exports.removeResourcesThatDontWorkLocally = removeResourcesThatDontWorkLocally;
//# sourceMappingURL=compile.js.map