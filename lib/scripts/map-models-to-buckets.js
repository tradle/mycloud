#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
process.env.IS_LAMBDA_ENVIRONMENT = 'false';
const path = require("path");
const fs = require("fs");
const utils_1 = require("../cli/utils");
utils_1.loadCredentials();
utils_1.loadRemoteEnv();
const lambda = require("../samplebot/lambda/mqtt/onmessage");
lambda.bot.promiseReady().then(() => {
    const { dbUtils } = lambda.tradle;
    const outputPath = path.join(__dirname, '../modelmap.json');
    const output = dbUtils.getModelMap({ models: lambda.bot.models });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
})
    .catch(err => {
    console.error(err.stack);
    process.exitCode = 1;
});
//# sourceMappingURL=map-models-to-buckets.js.map