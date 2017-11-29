#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('source-map-support').install();
const path = require("path");
const loadDockerEnv = require("node-env-file");
loadDockerEnv(path.resolve(__dirname, '../../docker/.env'));
const utils_1 = require("../cli/utils");
const dynogels = require("dynogels");
const TESTING = process.env.NODE_ENV === 'test';
if (TESTING) {
    require('../test/env').install();
}
else {
    utils_1.loadCredentials();
    console.log('WARNING: querying remote server');
}
const { port } = require('minimist')(process.argv.slice(2), {
    default: {
        port: require('../cli/serverless-yml').custom['serverless-offline'].port
    }
});
const { DYNAMO_ADMIN_PORT } = process.env;
const debug = require('debug')('dynogels');
dynogels.log = {
    info: debug,
    warn: debug,
    level: 'info'
};
const graphql_1 = require("../samplebot/lambda/http/graphql");
graphql_1.bot.router.listen(port);
console.log(`GraphiQL is at http://localhost:${port}`);
console.log(`DynamoDB Admin is at http://localhost:${DYNAMO_ADMIN_PORT}`);
//# sourceMappingURL=graphql-server.js.map