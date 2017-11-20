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
const _1 = require("../");
const utils_1 = require("../cli/utils");
const end_to_end_1 = require("../test/end-to-end");
const onmessage_1 = require("../samplebot/lambda/onmessage");
(() => __awaiter(this, void 0, void 0, function* () {
    const tradle = _1.createTestTradle();
    const opts = yield onmessage_1.promiseBot;
    yield end_to_end_1.clear(opts);
    yield new Promise(resolve => setTimeout(resolve, 3000));
    yield utils_1.genLocalResources({ tradle });
    const test = new end_to_end_1.Test(opts);
    yield test.runEmployeeAndCustomer();
}))()
    .catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=end-to-end-test.js.map