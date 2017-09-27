const debug = require('debug')('λ:subscribe');
const { wrap, user } = require('../..');
exports.handler = wrap(function* (event, context) {
    const { clientId, topics } = event;
    yield user.onSubscribed({ clientId, topics });
});
//# sourceMappingURL=onsubscribe.js.map