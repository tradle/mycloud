#!/usr/bin/env node
const { utils } = require('@tradle/engine');
let str = '';
process.stdin
    .on('data', data => {
    str += data.toString();
})
    .on('error', err => {
    throw err;
})
    .on('end', function () {
    process.stdout.write(utils.hexLink(JSON.parse(str)));
});
//# sourceMappingURL=getlink.js.map