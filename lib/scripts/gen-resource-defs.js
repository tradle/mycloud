#!/usr/bin/env node
process.env.IS_LAMBDA_ENVIRONMENT = false;
const path = require('path');
const fs = require('fs');
const { getTableDefinitions } = require('../cli/utils');
const defFilePath = path.resolve(__dirname, '../definitions.json');
fs.writeFile(defFilePath, JSON.stringify(getTableDefinitions(), null, 2));
//# sourceMappingURL=gen-resource-defs.js.map