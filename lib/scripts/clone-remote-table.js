#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../cli/utils");
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        s: 'source',
        d: 'destination'
    }
});
const { source, destination } = argv;
if (!(source && destination)) {
    throw new Error('expected "source" and "destination"');
}
utils_1.loadCredentials();
utils_1.cloneRemoteTable({ source, destination }).catch(err => {
    console.error(err.stack);
    process.exitCode = 1;
});
//# sourceMappingURL=clone-remote-table.js.map