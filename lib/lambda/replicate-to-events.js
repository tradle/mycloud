"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const _1 = require("../");
const { events, wrap } = new _1.Tradle();
exports.handler = wrap(function* (event, context) {
    const results = events.fromStreamEvent(event);
    if (results.length) {
        yield events.putEvents(results);
    }
}, { source: 'dynamodbstreams' });
//# sourceMappingURL=replicate-to-events.js.map