#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const engine_1 = require("@tradle/engine");
let str = '';
process.stdin
    .on('data', data => {
    str += data.toString();
})
    .on('error', err => {
    throw err;
})
    .on('end', function () {
    process.stdout.write(engine_1.utils.hexLink(JSON.parse(str)));
});
//# sourceMappingURL=getlink.js.map