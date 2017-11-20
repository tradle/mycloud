"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
process.env.LAMBDA_BIRTH_DATE = Date.now();
const _1 = require("../../");
const conf_1 = require("../conf");
const tradle = _1.createTradle();
const conf = conf_1.createConf({ tradle });
exports.handler = tradle.wrap(function* (event) {
    yield conf.setStyle(event);
}, { source: 'lambda' });
//# sourceMappingURL=set-style.js.map