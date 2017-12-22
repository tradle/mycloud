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
const path = require("path");
const fs = require("fs");
if (!fs.existsSync(path.resolve(process.cwd(), 'vars.yml'))) {
    throw new Error('expected vars.yml file');
}
const promisify = require("pify");
const _proc = require("child_process");
const proc = promisify(_proc);
const expectedNodeVersion = 'v6.10.3';
if (process.version !== expectedNodeVersion) {
    throw new Error(`expected Node.js ${expectedNodeVersion}, you're running ${process.version}`);
}
const yml = require('../cli/serverless-yml');
const stage = process.argv[2] || yml.custom.stage;
if (!/^[a-zA-Z-_]+$/.test(stage)) {
    throw new Error('invalid stage: ' + stage);
}
let command = `sls deploy --stage=${stage}`;
(() => __awaiter(this, void 0, void 0, function* () {
    try {
        const pathToNtfy = yield proc.exec('which ntfy', {
            cwd: process.cwd(),
            stdio: 'inherit'
        });
        if (pathToNtfy) {
            command = 'ntfy done ' + command;
        }
    }
    catch (err) { }
    console.log(command);
    proc.execSync(command, {
        cwd: process.cwd(),
        stdio: 'inherit'
    });
}))()
    .catch(err => {
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=deploy.js.map