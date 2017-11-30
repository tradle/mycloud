"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../../init-lambda");
const { debug, wrap, user } = require('../..').tradle;
exports.handler = wrap(function* (event, context) {
    const { clientId, topics } = event;
    yield user.onSubscribed({ clientId, topics });
}, { source: 'iot' });
//# sourceMappingURL=onsubscribe.js.map