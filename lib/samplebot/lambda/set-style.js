"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
process.env.LAMBDA_BIRTH_DATE = Date.now();
const _1 = require("../../");
const configure_1 = require("../configure");
const tradle = _1.createTradle();
const conf = configure_1.createConf({ tradle });
exports.handler = tradle.wrap(function* (event) {
    yield conf.setStyle(event);
}, { source: 'lambda' });
//# sourceMappingURL=set-style.js.map