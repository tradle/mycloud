const co = require('co').wrap;
const { getter } = require('../utils');
module.exports = function fakeSeals(opts = {}) {
    const { seals = {} } = opts;
    return {
        create: co(function* ({ link }) {
            seals[link] = { link };
        }),
        get: getter(seals)
    };
};
//# sourceMappingURL=seals.js.map