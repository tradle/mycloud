#!/usr/bin/env node
process.env.IS_LAMBDA_ENVIRONMENT = false;
const co = require('co');
const yn = require('yn');
const readline = require('readline');
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        f: 'force',
        t: 'types'
    }
});
const { loadEnv, loadCredentials, clearTypes } = require('../cli/utils');
loadEnv();
loadCredentials();
co(function* () {
    const types = (argv.types || '').split(',').map(str => str.trim());
    if (!types.length) {
        throw new Error('expected "types" comma-separated list');
    }
    console.log('will delete types:', types.join(','));
    if (!argv.force) {
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
    clearTypes({ types });
})
    .catch(err => {
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=delete-types.js.map