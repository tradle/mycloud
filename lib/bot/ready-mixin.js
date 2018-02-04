"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
function readyMixin(emitter) {
    let resolveReady;
    const promise = new Promise(resolve => {
        resolveReady = resolve;
    })
        .then(() => emitter.emit('ready'));
    Object.assign(emitter, {
        ready: () => resolveReady(),
        isReady: () => promise.isFulfilled(),
        promiseReady: () => promise
    });
    return emitter;
}
exports.readyMixin = readyMixin;
//# sourceMappingURL=ready-mixin.js.map