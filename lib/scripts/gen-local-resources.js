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
process.env.IS_LOCAL = 'true';
process.env.DEBUG = process.env.DEBUG || 'tradle*';
require('source-map-support').install();
console.warn(`if you made any changes to serverless-uncompiled.yml
make sure to run: npm run build:yml before running this script
`);
const { force } = require('minimist')(process.argv.slice(2), {
    boolean: ['force']
});
const utils_1 = require("../cli/utils");
const rethrow = (err) => {
    if (err)
        throw err;
};
(() => __awaiter(this, void 0, void 0, function* () {
    yield utils_1.initializeProvider();
}))()
    .catch(err => {
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=gen-local-resources.js.map