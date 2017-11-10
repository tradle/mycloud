#!/usr/bin/env node
const YAML = require('js-yaml');
const dotProp = require('dot-prop');
const [path, ...args] = process.argv.slice(2);
const { interpolateTemplate } = require('../cli/utils');
interpolateTemplate(args.join(' '))
    .then(result => {
    const yml = YAML.load(result);
    const val = dotProp.get(yml, path);
    if (typeof val === 'undefined') {
        throw new Error(`property path ${path} not found in yml`);
    }
    process.stdout.write(val);
}, err => {
    process.stderr.write(err.stack);
    process.exit(1);
});
//# sourceMappingURL=var.js.map