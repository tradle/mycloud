"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = require("../");
const { events } = _1.tradle;
exports.handler = _1.wrap(function* (event, context) {
    const results = events.fromStreamEvent(event);
    if (results.length) {
        yield events.putEvents(results);
    }
});
//# sourceMappingURL=replicate-to-events.js.map