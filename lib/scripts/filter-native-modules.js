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
const utils_2 = require("../utils");
const modules = [];
const promiseNative = utils_1.getNativeModules();
process.stdin
    .on('data', paths => {
    paths.toString().split('\n').forEach(filePath => {
        modules.push(filePath.split('node_modules/').pop());
    });
})
    .on('end', () => __awaiter(this, void 0, void 0, function* () {
    const native = yield promiseNative;
    const prodNative = utils_2.uniqueStrict(modules).filter(name => {
        return native.find(str => str === name);
    });
    process.stdout.write(prodNative.join(' '));
}));
process.on('unhandledRejection', err => {
    process.exitCode = 1;
    console.error(err.stack);
});
//# sourceMappingURL=filter-native-modules.js.map