#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const YAML = require("js-yaml");
const utils_1 = require("../cli/utils");
const [path, ...args] = process.argv.slice(2);
utils_1.interpolateTemplate({ arg: args.join(' ') })
    .then(result => {
    const yml = YAML.load(result);
    const val = _.get(yml, path);
    if (typeof val === 'undefined') {
        throw new Error(`property path ${path} not found in yml`);
    }
    process.stdout.write(val);
}, err => {
    process.stderr.write(err.stack);
    process.exit(1);
});
//# sourceMappingURL=var.js.map