#!/usr/bin/env node
process.env.IS_LAMBDA_ENVIRONMENT = 'false';
const path = require('path');
const co = require('co');
const { loadCredentials } = require('../cli/utils');
loadCredentials();
const { buckets, s3Utils } = require('../').createRemoteTradle();
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        c: 'conf'
    },
    default: {
        conf: path.resolve(__dirname, '../samplebot/default-conf.json')
    }
});
const { custom } = require('../cli/serverless-yml');
const confPath = path.resolve(process.cwd(), argv.conf);
const conf = require(confPath);
console.log(`setting conf in: ${confPath}`);
co(function* () {
    const result = yield buckets.PublicConf.putJSON('bot-conf.json', conf);
    console.log('conf put successfully', result);
})
    .catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=setbotconf.js.map