const debug = require('debug')('λ:ondisconnect');
const { wrap, user, stringUtils } = require('../..');
const { onDisconnected } = user;
const { prettify } = stringUtils;
exports.handler = wrap(function* (event, context) {
    debug('client disconnected', prettify(event));
    const { clientId } = event;
    yield onDisconnected({ clientId });
});
//# sourceMappingURL=ondisconnect.js.map