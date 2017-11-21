#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
require('source-map-support').install();
const path = require("path");
const loadDockerEnv = require("node-env-file");
loadDockerEnv(path.resolve(__dirname, '../../docker/.env'));
const utils_1 = require("../cli/utils");
const express = require("express");
const expressGraphQL = require("express-graphql");
const compression = require("compression");
const cors = require("cors");
const dynogels = require("dynogels");
const bot_1 = require("../samplebot/bot");
const sample_queries_1 = require("../samplebot/sample-queries");
const graphql_1 = require("../bot/graphql");
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
(() => __awaiter(this, void 0, void 0, function* () {
    const { bot } = yield bot_1.createBot();
    const graphqlAPI = graphql_1.setupGraphQL(bot);
    const app = express();
    app.use(cors());
    app.use(compression());
    app.use('/', expressGraphQL(req => ({
        schema: graphqlAPI.schema,
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
}))();
//# sourceMappingURL=graphql-server.js.map