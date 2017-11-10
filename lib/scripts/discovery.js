#!/usr/bin/env node
const { getStackName } = require('../cli/utils');
const stackName = getStackName();
process.env.AWS_LAMBDA_FUNCTION_NAME = `${stackName}-setenvvars`;
process.env.SERVERLESS_PREFIX = `${stackName}-`;
const co = require('co');
const { discovery } = require('../');
co(discover)
    .then(env => {
    process.stdout.write(JSON.stringify(env, null, 2));
})
    .catch(console.error);
function* discover() {
    return yield discovery.discoverServices(stackName);
}
//# sourceMappingURL=discovery.js.map