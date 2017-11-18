#!/usr/bin/env node
process.env.IS_LAMBDA_ENVIRONMENT = false;
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { loadCredentials, getTableDefinitions } = require('../cli/utils');
loadCredentials();
const { dbUtils } = require('../').createRemoteTradle();
const { models } = require('../samplebot');
const outputPath = path.join(__dirname, '../modelmap.json');
const output = dbUtils.getModelMap({ models });
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
//# sourceMappingURL=map-models-to-buckets.js.map