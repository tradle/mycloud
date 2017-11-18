"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
process.env.LAMBDA_BIRTH_DATE = Date.now();
const _1 = require("../");
const configure_provider_1 = require("../configure-provider");
const tradle = new _1.Tradle();
const { wrap } = tradle;
exports.handler = wrap(function* (event) {
    yield configure_provider_1.setStyle({
        buckets: tradle.buckets,
        style: event
    });
}, { source: 'lambda' });
//# sourceMappingURL=setstyle.js.map