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
(() => __awaiter(this, void 0, void 0, function* () {
    const [modules, prod] = yield Promise.all([
        utils_1.getNativeModules(),
        utils_1.getProductionModules()
    ]);
    const prodOnly = modules.filter(name => {
        return prod.find(info => info.name === name);
    });
    process.stdout.write(prodOnly.join(' '));
}))()
    .catch(err => {
    process.exitCode = 1;
    console.error(err.stack);
});
//# sourceMappingURL=get-native-prod-modules.js.map