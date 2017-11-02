"use strict";
const { co } = require('../utils');
module.exports = function createSealsAPI({ provider, seals }) {
    const createSeal = co(function* (opts) {
        const chainKey = yield provider.getMyChainKey();
        yield seals.create(Object.assign({}, opts, { key: chainKey }));
    });
    return {
        create: createSeal,
        get: seals.get
    };
};
//# sourceMappingURL=seals.js.map