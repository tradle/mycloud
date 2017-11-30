"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const _1 = require("../");
const tradle = _1.createTradle();
const { debug, wrap, seals } = tradle;
const SIX_HOURS = 6 * 3600 * 1000;
exports.handler = wrap(function (event, context) {
    debug('[START]', Date.now());
    return seals.handleFailures({ gracePeriod: SIX_HOURS });
}, { source: 'schedule' });
//# sourceMappingURL=check-failed-seals.js.map