const debug = require('debug')('λ:onconnect');
const { wrap, user, stringUtils } = require('../..');
const { onConnected } = user;
const { prettify } = stringUtils;
exports.handler = wrap(function* (event, context) {
    debug('client connected', prettify(event));
    const { clientId } = event;
    yield onConnected({ clientId });
    // yield bot.exports.onpresence({
    //   event: 'online',
    //   user:
    // })
});
//# sourceMappingURL=onconnect.js.map