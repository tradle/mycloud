"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const tradle = require('../').tradle;
const { wrap, env } = tradle;
exports.handler = wrap(function* (event) {
    const { url } = event;
    if (!url) {
        throw new Error('"url" is required');
    }
    yield tradle.friends.load({ url });
    console.log('DONE LOADING FRIEND');
}, { source: 'lambda' });
//# sourceMappingURL=add-friend.js.map