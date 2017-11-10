process.env.LAMBDA_BIRTH_DATE = Date.now();
const { debug, wrap, user, env, stringUtils, utils, constants } = require('../..').tradle;
const { prettify } = stringUtils;
const { SEQ } = constants;
const { timestamp } = utils;
exports.handler = wrap(function* (event, context) {
    debug('[START]', timestamp());
    let { topic, clientId, data } = event;
    if (!clientId && env.IS_OFFLINE) {
        clientId = topic.match(/\/([^/]+)\/[^/]+/)[1];
    }
    const message = new Buffer(data.data, 'base64');
    yield user.onSentMessage({ clientId, message });
    debug('preceived');
}, { source: 'iot' });
//# sourceMappingURL=onmessage.js.map