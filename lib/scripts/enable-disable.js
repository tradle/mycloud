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
const utils_1 = require("../cli/utils");
const _1 = require("../");
const { enable } = require('minimist')(process.argv.slice(2), {
    alias: {
        e: 'enable'
    },
    boolean: ['enable']
});
const yml = require('../cli/serverless-yml');
const { service, custom: { stage, prefix } } = yml;
utils_1.loadCredentials();
console.log('service', service);
console.log('stage', stage);
const action = enable ? 'enable' : 'disable';
console.log(`will ${action} all functions starting with prefix ${prefix}`);
(() => __awaiter(this, void 0, void 0, function* () {
    yield _1.lambdaUtils.updateEnvironments(function ({ FunctionName }) {
        if (FunctionName.startsWith(prefix)) {
            return {
                DISABLED: enable ? null : 'y'
            };
        }
    });
}))()
    .catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=enable-disable.js.map