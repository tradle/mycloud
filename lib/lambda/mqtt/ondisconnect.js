"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../../init-lambda");
const { debug, wrap, user, stringUtils } = require('../..').tradle;
const { onDisconnected } = user;
const { prettify } = stringUtils;
exports.handler = wrap(function* (event, context) {
    debug('client disconnected', prettify(event));
    const { clientId } = event;
    yield onDisconnected({ clientId });
}, { source: 'iot' });
//# sourceMappingURL=ondisconnect.js.map