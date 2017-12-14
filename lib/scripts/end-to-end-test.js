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
require('source-map-support').install();
require('../test/env').install();
const utils_1 = require("../cli/utils");
const end_to_end_1 = require("../test/end-to-end");
const _1 = require("../");
const bot_1 = require("../bot");
const customize_1 = require("../samplebot/customize");
(() => __awaiter(this, void 0, void 0, function* () {
    let tradle = _1.createTestTradle();
    const { debug } = tradle.logger;
    yield end_to_end_1.clear({ tradle });
    debug('cleared stored data');
    tradle = _1.createTestTradle();
    yield utils_1.initializeProvider({ bot: bot_1.createBot({ tradle }) });
    debug('initialized provider');
    tradle.logger.debug('setting up bot');
    const bot = bot_1.createBot();
    const customStuff = yield customize_1.customize({ bot });
    tradle.logger.debug('running test');
    const test = new end_to_end_1.Test(customStuff);
    yield test.runEmployeeAndCustomer();
}))()
    .catch(err => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=end-to-end-test.js.map