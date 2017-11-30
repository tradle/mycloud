"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const { wrap, seals, debug } = require('../').tradle;
exports.handler = wrap(function () {
    debug('[START]', Date.now());
    return seals.sealPending();
});
//# sourceMappingURL=sealpending.js.map