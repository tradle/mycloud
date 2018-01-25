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
const utils_1 = require("../cli/utils");
utils_1.loadCredentials();
const yn = require("yn");
const readline = require("readline");
const _1 = require("../");
const { aws, env, dbUtils } = _1.tradle;
const { listTables, clear } = dbUtils;
const tableToClear = process.argv.slice(2);
const skip = [
    'pubkeys',
    'presence',
    'events',
    'seals',
    'tradle_MyCloudFriend'
];
const { href } = aws.dynamodb.endpoint;
const getTablesToClear = (tables = process.argv.slice(2)) => __awaiter(this, void 0, void 0, function* () {
    if (tables.length) {
        tables = tables.map(name => {
            return name.startsWith(env.SERVERLESS_PREFIX) ? name : env.SERVERLESS_PREFIX + name;
        });
    }
    else {
        tables = yield listTables(env);
        tables = tables.filter(name => {
            return !skip.find(skippable => env.SERVERLESS_PREFIX + skippable === name);
        });
    }
    console.log(`will empty the following tables at endpoint ${href}\n`, tables);
    const rl = readline.createInterface(process.stdin, process.stdout);
    const answer = yield new Promise(resolve => {
        rl.question('continue? y/[n]:', resolve);
    });
    rl.close();
    if (!yn(answer)) {
        console.log('aborted');
        return;
    }
    return tables;
});
const clearTables = () => __awaiter(this, void 0, void 0, function* () {
    const tables = yield getTablesToClear();
    if (!(tables && tables.length))
        return;
    console.log(`will empty the following tables at endpoint ${href}\n`, tables);
    console.log('let the games begin!');
    for (const table of tables) {
        console.log('clearing', table);
        const numDeleted = yield clear(table);
        console.log(`deleted ${numDeleted} items from ${table}`);
    }
    console.log('done!');
});
clearTables().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=clear-tables.js.map