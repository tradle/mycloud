#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('source-map-support').install();
const path = require("path");
const loadDockerEnv = require("node-env-file");
loadDockerEnv(path.resolve(__dirname, '../../docker/.env'));
const utils_1 = require("../cli/utils");
const _1 = require("../");
const express = require("express");
const expressGraphQL = require("express-graphql");
const compression = require("compression");
const cors = require("cors");
const dynogels = require("dynogels");
const strategy_1 = require("../samplebot/strategy");
const sample_queries_1 = require("../samplebot/sample-queries");
const TESTING = process.env.NODE_ENV === 'test';
if (!TESTING) {
    utils_1.loadCredentials();
    console.log('WARNING: querying remote server');
}
const { bot } = strategy_1.products({
    tradle: TESTING ? _1.createTestTradle() : _1.createRemoteTradle()
});
const { port } = require('minimist')(process.argv.slice(2), {
    default: {
        port: 21012
    }
});
const { DYNAMO_ADMIN_PORT } = process.env;
const debug = require('debug')('dynogels');
dynogels.log = {
    info: debug,
    warn: debug,
    level: 'info'
};
const app = express();
app.use(cors());
app.use(compression());
app.use('/', expressGraphQL(req => ({
    schema: bot.graphqlAPI.schema,
    graphiql: {
        logo: {
            src: 'https://blog.tradle.io/content/images/2016/08/256x-no-text-1.png',
            width: 32,
            height: 32
        },
        bookmarks: {
            title: 'Samples',
            items: sample_queries_1.default
        }
    },
    pretty: true
})));
app.listen(port);
console.log(`GraphiQL is at http://localhost:${port}`);
console.log(`DynamoDB Admin is at http://localhost:${DYNAMO_ADMIN_PORT}`);
//# sourceMappingURL=graphql-server.js.map