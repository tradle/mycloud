"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
process.env.LAMBDA_BIRTH_DATE = Date.now();
const tradle_1 = require("../tradle");
const tradle = new tradle_1.default();
const { debug, wrap, seals } = tradle;
const SIX_HOURS = 6 * 3600 * 1000;
exports.handler = wrap(function (event, context) {
    debug('[START]', Date.now());
    return seals.handleFailures({ gracePeriod: SIX_HOURS });
}, { source: 'schedule' });
//# sourceMappingURL=check-failed-seals.js.map