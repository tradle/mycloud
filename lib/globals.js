"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = global.Promise = require('bluebird');
const AWS = require("aws-sdk");
const source_map_support_1 = require("source-map-support");
source_map_support_1.install();
AWS.config.setPromisesDependency(Promise);
const mockery = require('mockery');
mockery.enable({
    warnOnReplace: false,
    warnOnUnregistered: false
});
console.warn('disabling "scrypt" as it is an unneeded dep (here) of ethereumjs-wallet');
mockery.registerMock('scrypt', {});
if (process.env.IS_OFFLINE || process.env.IS_LOCAL || process.env.NODE_ENV === 'test') {
    console.warn('disabling "aws-xray-sdk" as this is a local environment');
    mockery.registerMock('aws-xray-sdk', null);
}
//# sourceMappingURL=globals.js.map