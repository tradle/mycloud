const locker = require('promise-locker');
const noop = () => { };
module.exports = function createLocker(opts = {}) {
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
        }
    };
};
//# sourceMappingURL=locker.js.map