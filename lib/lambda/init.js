"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const { wrap, init, env } = require('../').tradle;
exports.handler = wrap(function* (event, context) {
    const { name = env.ORG_NAME, domain = env.ORG_DOMAIN, logo, force = false } = event;
    yield init.init({ name, domain, logo, force });
}, { source: 'lambda' });
//# sourceMappingURL=init.js.map