"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const { wrap, events } = require('../').tradle;
const { putEvent } = events;
exports.handler = wrap(function* (event, context) {
    yield putEvent(event);
});
//# sourceMappingURL=createevent.js.map