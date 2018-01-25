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
const path = require("path");
const utils_1 = require("../cli/utils");
const _1 = require("../");
const { lambdaUtils } = _1.createRemoteTradle();
const argv = require('minimist')(process.argv.slice(2), {
    alias: {
        f: 'functions',
        p: 'path'
    }
});
const yml = require('../cli/serverless-yml');
const { custom, provider } = yml;
const env = argv.path
    ? require(path.resolve(process.cwd(), argv.path))
    : minusObjectValues(provider.environment);
utils_1.loadCredentials();
if (!(env && Object.keys(env).length)) {
    throw new Error('provided env json is empty');
}
console.log('setting env', JSON.stringify(env, null, 2));
(() => __awaiter(this, void 0, void 0, function* () {
    const functions = argv.functions && argv.functions.split(',').map(f => f.trim());
    yield lambdaUtils.updateEnvironments(function ({ FunctionName }) {
        if (functions && !functions.includes(FunctionName.slice(custom.prefix.length))) {
            console.log('not updating', FunctionName);
            return null;
        }
        console.log('updating', FunctionName);
        return env;
    });
}))()
    .catch(err => {
    console.error(err);
    process.exit(1);
});
function minusObjectValues(obj) {
    const minus = {};
    for (let key in obj) {
        let val = obj[key];
        if (typeof val !== 'object') {
            minus[key] = val;
        }
    }
    return minus;
}
//# sourceMappingURL=setenv.js.map