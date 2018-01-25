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
const yn = require("yn");
const readline = require("readline");
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        f: 'force',
        t: 'types'
    }
});
const utils_1 = require("../cli/utils");
utils_1.loadCredentials();
const _1 = require("../");
const tradle = _1.createRemoteTradle();
(() => __awaiter(this, void 0, void 0, function* () {
    const types = (argv.types || '').split(',').map(str => str.trim());
    if (!types.length) {
        throw new Error('expected "types" comma-separated list');
    }
    console.log('will delete types:', types.join(','));
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
    utils_1.clearTypes({ tradle, types });
}))()
    .catch(err => {
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=delete-types.js.map