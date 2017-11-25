#!/usr/bin/env node
process.env.IS_LAMBDA_ENVIRONMENT = false;
const path = require('path');
const co = require('co');
const { loadCredentials } = require('../cli/utils');
const { lambdaUtils } = require('../').createRemoteTradle();
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        f: 'functions',
        p: 'path'
    }
});
const { provider } = require('../cli/serverless-yml');
const env = argv.path
    ? require(path.resolve(process.cwd(), argv.path))
    : minusObjectValues(provider.environment);
loadCredentials();
if (!(env && Object.keys(env).length)) {
    throw new Error('provided env json is empty');
}
console.log('setting env', JSON.stringify(env, null, 2));
co(function* () {
    const functions = argv.functions && argv.functions.split(',').map(f => f.trim());
    yield lambdaUtils.updateEnvironments(function ({ FunctionName }) {
        if (functions && !functions.includes(FunctionName.slice(custom.prefix.length))) {
            console.log('not updating', FunctionName);
            return null;
        }
        console.log('updating', FunctionName);
        return env;
    });
})
    .catch(err => {
    console.error(err);
    process.exit(1);
});
function minusObjectValues(obj) {
    const minus = {};
    for (let key in obj) {
        let val = obj[key];
        if (typeof val !== 'object') {
            minus[key] = val;
        }
    }
    return minus;
}
//# sourceMappingURL=setenv.js.map