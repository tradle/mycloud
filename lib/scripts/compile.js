#!/usr/bin/env node
require('source-map-support').install();
const path = require('path');
const fs = require('fs');
const debug = require('debug')('tradle:sls:compile');
const { compileTemplate, interpolateTemplate } = require('../cli/utils');
let { input, output } = require('minimist')(process.argv.slice(2), {
    alias: {
        i: 'input',
        o: 'output'
    }
});
input = path.resolve(process.cwd(), input);
output = path.resolve(process.cwd(), output);
compileTemplate(input)
    .then(compiled => fs.writeFileSync(output, compiled), err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=compile.js.map