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
process.env.IS_LAMBDA_ENVIRONMENT = 'false';
require('source-map-support').install();
const yn = require("yn");
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        f: 'force'
    }
});
const { loadCredentials, clearTypes } = require('../cli/utils');
loadCredentials();
const _1 = require("../");
const customize_1 = require("../samplebot/customize");
const tradle = _1.createRemoteTradle();
const bot = require('../bot').createBot({ tradle });
const { db, dbUtils, env } = tradle;
const { SERVERLESS_PREFIX } = env;
const { clear } = dbUtils;
const definitions = require('../definitions');
const readline = require('readline');
const deleteApplications = () => __awaiter(this, void 0, void 0, function* () {
    const { productsAPI } = yield customize_1.customize({ bot });
    const models = productsAPI.models.all;
    console.log('finding victims...');
    const modelsToDelete = Object.keys(models).filter(id => {
        const model = models[id];
        if (id === 'tradle.Application' ||
            id === 'tradle.AssignRelationshipManager' ||
            id === 'tradle.Verification' ||
            id === 'tradle.FormRequest') {
            return true;
        }
        const { subClassOf } = model;
        if (subClassOf === 'tradle.Form' ||
            subClassOf === 'tradle.MyProduct') {
            return true;
        }
    });
    const tablesToClear = [definitions.UsersTable.Properties.TableName];
    console.log(`1. will delete the following types: ${JSON.stringify(modelsToDelete, null, 2)}`);
    console.log('2. will also clear the following tables\n', tablesToClear);
    if (!argv.force) {
        const rl = readline.createInterface(process.stdin, process.stdout);
        const answer = yield new Promise(resolve => {
            rl.question('continue? y/[n]:', resolve);
        });
        rl.close();
        if (!yn(answer)) {
            console.log('aborted');
            return;
        }
    }
    console.log('let the games begin!');
    const deleteCounts = yield clearTypes({
        tradle,
        types: Object.keys(models)
    });
    console.log(`deleted items count: ${JSON.stringify(deleteCounts, null, 2)}`);
    for (const table of tablesToClear) {
        console.log('clearing', table);
        const numDeleted = yield clear(table);
        console.log(`deleted ${numDeleted} items from ${table}`);
    }
});
deleteApplications().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=delete-applications.js.map