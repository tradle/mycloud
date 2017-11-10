#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const debug = require('debug')('tradle:sls:compile');
const { compileTemplate, interpolateTemplate } = require('../cli/utils');
const [input, output] = process.argv.slice(2).map(file => path.resolve(process.cwd(), file));
compileTemplate(input)
    .then(compiled => fs.writeFileSync(output, compiled), err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=compile.js.map