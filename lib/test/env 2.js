"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require("crypto");
require("../lib/globals");
require('source-map-support').install();
const AWS = require("aws-sdk-mock");
const serviceMap = require("./service-map");
const { brand } = require('../lib/cli/serverless-yml').custom;
const brandEnv = brand.env || {};
const debug = require('debug')('tradle:sls:test:env');
const props = Object.assign({}, process.env, serviceMap, { NODE_ENV: 'test', AWS_REGION: 'us-east-1', IS_LOCAL: true }, brandEnv);
exports.createTestEnv = () => {
    const Env = require('../lib/env');
    return new Env(props);
};
exports.install = (target = process.env) => {
    if (typeof target.set === 'function') {
        target.set(props);
    }
    else {
        Object.assign(target, props);
    }
    AWS.mock('STS', 'assumeRole', (params, callback) => {
        debug('assumed role');
        callback(null, {
            AssumedRoleUser: {
                AssumedRoleId: randomBase64(32)
            },
            Credentials: {
                AccessKeyId: randomBase64(15),
                SecretAccessKey: randomBase64(30),
                SessionToken: randomBase64(128)
            }
        });
    });
};
const randomBase64 = (bytes) => crypto.randomBytes(bytes).toString('base64');
//# sourceMappingURL=env 2.js.map