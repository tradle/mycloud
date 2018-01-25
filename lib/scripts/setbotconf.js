#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
process.env.IS_LAMBDA_ENVIRONMENT = 'false';
const path = require("path");
const co = require("co");
const utils_1 = require("../cli/utils");
utils_1.loadCredentials();
const _1 = require("../");
const { buckets, s3Utils } = _1.createRemoteTradle();
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        c: 'conf'
    },
    default: {
        conf: path.resolve(__dirname, '../samplebot/default-conf.json')
    }
});
const yml = require('../cli/serverless-yml');
const { custom } = yml;
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