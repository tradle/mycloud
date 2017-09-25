const wrap = require('../wrap');
const { getMyIdentity } = require('../provider');
exports.handler = wrap(function (event, context) {
    return getMyIdentity();
});
//# sourceMappingURL=identity.js.map