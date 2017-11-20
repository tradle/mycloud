#!/usr/bin/env node
process.env.IS_LAMBDA_ENVIRONMENT = false;
const co = require('co');
const yn = require('yn');
const readline = require('readline');
const tradle = require('../').createRemoteTradle();
const { aws } = tradle;
const { batchify, runWithBackoffWhile } = require('../utils');
const yml = require('../cli/serverless-yml');
const { service, stage, profile, force } = require('minimist')(process.argv.slice(2), {
    boolean: ['force'],
    default: {
        profile: yml.provider.profile,
        stage: yml.provider.stage,
        service: yml.service
    }
});
if (!(service && stage && profile)) {
    throw new Error('expected "--service", "--stage" and "--profile"');
}
const { loadCredentials, getStackResources } = require('../cli/utils');
const serviceStageRegExp = new RegExp(`^${service}-${stage}-`);
const { service: { resources: { Resources } } } = require('../.serverless/serverless-state');
loadCredentials();
co(function* () {
    let stackTables = [];
    try {
        const stackResources = yield getStackResources();
        stackTables = stackResources
            .filter(res => res.ResourceType === 'AWS::DynamoDB::Table')
            .map(res => res.PhysicalResourceId);
    }
    catch (err) {
        if (!/stack.*does not exist/i.test(err.message)) {
            throw err;
        }
    }
    const { TableNames } = yield aws.dynamodb.listTables().promise();
    const toDelete = TableNames.filter(name => {
        return !stackTables.includes(name) && serviceStageRegExp.test(name);
    });
    if (!toDelete.length)
        return;
    console.log('will delete', JSON.stringify(toDelete, null, 2));
    if (!force) {
        const rl = readline.createInterface(process.stdin, process.stdout);
        const answer = yield new Promise(resolve => {
            rl.question('continue? y/[n]:', resolve);
        });
        rl.close();
        if (!yn(answer)) {
            console.log('aborted');
            return;
        }
    }
    for (const TableName of toDelete) {
        console.log(`deleting ${TableName}`);
        yield runWithBackoffWhile(co.wrap(function* () {
            yield aws.dynamodb.deleteTable({ TableName }).promise();
        }), {
            shouldTryAgain: err => {
                const willRetry = err.name === 'LimitExceededException';
                console.log(`error deleting ${TableName}: ${err.name}, will retry: ${willRetry}`);
                return willRetry;
            },
            initialDelay: 1000,
            maxDelay: 10000,
            maxAttempts: Infinity,
            maxTime: Infinity
        });
    }
    console.log('deleted', toDelete);
})
    .catch(console.error);
//# sourceMappingURL=delete-tables.js.map