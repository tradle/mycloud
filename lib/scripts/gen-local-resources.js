#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
process.env.IS_LOCAL = 'true';
process.env.DEBUG = process.env.DEBUG || 'tradle*';
require('source-map-support').install();
console.warn(`if you made any changes to serverless-uncompiled.yml
make sure to run: npm run build:yml before running this script
`);
const { force } = require('minimist')(process.argv.slice(2), {
    boolean: ['force']
});
const utils_1 = require("../cli/utils");
const rethrow = (err) => {
    if (err)
        throw err;
};
utils_1.initializeProvider().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=gen-local-resources.js.map