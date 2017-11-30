"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const { tradle, bot } = require('../samplebot');
const { wrap } = tradle;
exports.handler = wrap(function* (event, context) {
    yield bot.seal(event);
});
//# sourceMappingURL=seal.js.map