"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const locker = require("promise-locker");
const noop = (...any) => { };
function createLocker(opts = {}) {
    const { name = '', debug = noop } = opts;
    const lock = locker(opts);
    const unlocks = {};
    const lDebug = (...args) => {
        if (name)
            args.unshift(name);
        return debug(...args);
    };
    return {
        lock: id => {
            debug(name, `locking ${id}`);
            return lock(id).then(unlock => {
                debug(name, `locked ${id}`);
                unlocks[id] = unlock;
            });
        },
        unlock: id => {
            if (unlocks[id]) {
                debug(name, `unlocking ${id}`);
                unlocks[id]();
                return true;
            }
            return false;
        }
    };
}
exports.createLocker = createLocker;
//# sourceMappingURL=locker.js.map