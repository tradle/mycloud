"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require('bluebird');
function readyMixin(emitter) {
    let resolveReady;
    const promise = new Promise(resolve => {
        resolveReady = resolve;
    })
        .then(() => emitter.emit('ready'));
    emitter.ready = () => {
        resolveReady();
    };
    emitter.isReady = () => promise.isPending();
    emitter.promiseReady = () => promise;
}
exports.readyMixin = readyMixin;
//# sourceMappingURL=ready-mixin.js.map