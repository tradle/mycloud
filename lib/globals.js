"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
const source_map_support_1 = require("source-map-support");
source_map_support_1.install();
global.Promise = Promise;
process.on('unhandledRejection', function (reason, promise) {
    console.error('possibly unhandled rejection', reason);
});
const mockery = require('mockery');
mockery.enable({
    warnOnReplace: false,
    warnOnUnregistered: false
});
mockery.registerMock('scrypt', {});
console.warn('mocking "scrypt" as it is an unneeded dep (here) of ethereumjs-wallet');
//# sourceMappingURL=globals.js.map