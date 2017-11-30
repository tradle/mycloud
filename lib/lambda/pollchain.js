"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const { debug, wrap, seals } = require('../').tradle;
exports.handler = wrap(function (event, context) {
    debug('[START]', Date.now());
    return seals.syncUnconfirmed();
}, { source: 'schedule' });
//# sourceMappingURL=pollchain.js.map