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
process.env.IS_LOCAL = true;
process.env.DEBUG = process.env.DEBUG || 'tradle*';
console.warn(`if you made any changes to serverless-uncompiled.yml
make sure to run: npm run build:yml before running this script
`);
const { force } = require('minimist')(process.argv.slice(2), {
    boolean: ['force']
});
const promisify = require("pify");
const _1 = require("../");
const utils_1 = require("../cli/utils");
const init_1 = require("../samplebot/lambda/init");
const provider_1 = require("../../conf/provider");
const Errors = require("../errors");
const rethrow = (err) => {
    if (err)
        throw err;
};
(() => __awaiter(this, void 0, void 0, function* () {
    try {
        yield utils_1.genLocalResources({ tradle: _1.tradle });
        yield promisify(init_1.handler)({
            RequestType: 'Create',
            ResourceProperties: {
                org: {
                    name: provider_1.org.name + '-local',
                    domain: provider_1.org.domain + '.local',
                    logo: provider_1.org.logo
                }
            }
        }, {});
    }
    catch (err) {
        Errors.ignore(err, Errors.Exists);
        console.log('prevented overwrite of existing identity/keys');
    }
}))()
    .catch(err => {
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=gen-local-resources.js.map