#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_utils_1 = require("../db-utils");
let str = '';
process.stdin
    .on('data', function (data) {
    str += data.toString();
})
    .on('end', function () {
    const { Item, Items } = JSON.parse(str);
    const unmarshalled = Item ? db_utils_1.unmarshalDBItem(Item) : Items.map(db_utils_1.unmarshalDBItem);
    process.stdout.write(JSON.stringify(unmarshalled, null, 2));
});
//# sourceMappingURL=unmarshal.js.map