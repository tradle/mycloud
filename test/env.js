"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../lib/globals");
require('source-map-support').install();
const AWS = require("aws-sdk-mock");
const serviceMap = require("./service-map");
const debug = require('debug')('tradle:sls:test:env');
const props = Object.assign({}, serviceMap, { NODE_ENV: 'test', IS_LOCAL: true });
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
                AssumedRoleId: 'abcdef'
            },
            Credentials: {
                AccessKeyId: 'abc',
                SecretAccessKey: 'def',
                SessionToken: 'ghi'
            }
        });
    });
};
//# sourceMappingURL=env.js.map