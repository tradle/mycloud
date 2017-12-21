#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
process.env.IS_LAMBDA_ENVIRONMENT = 'false';
const path = require("path");
const fs = require("fs");
const utils_1 = require("../cli/utils");
const defFilePath = path.resolve(__dirname, '../definitions.json');
fs.writeFile(defFilePath, JSON.stringify(utils_1.getTableDefinitions(), null, 2), err => {
    if (err)
        throw err;
});
//# sourceMappingURL=gen-resource-defs.js.map