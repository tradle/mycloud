"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const tradle = require('../').tradle;
const { debug, wrap, identities } = tradle;
exports.handler = wrap(function (event, context) {
    const { link } = event;
    debug('adding contact', link);
    return identities.addContact({ link });
}, { source: 'lambda' });
//# sourceMappingURL=add-contact.js.map