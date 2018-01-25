#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('source-map-support').install();
const path = require("path");
const fs = require("fs");
const utils_1 = require("../cli/utils");
const debug = require('debug')('tradle:sls:compile');
let { input, output } = require('minimist')(process.argv.slice(2), {
    alias: {
        i: 'input',
        o: 'output'
    }
});
input = path.resolve(process.cwd(), input);
output = path.resolve(process.cwd(), output);
utils_1.compileTemplate(input)
    .then(compiled => fs.writeFileSync(output, compiled), err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=compile.js.map