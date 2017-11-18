process.env.LAMBDA_BIRTH_DATE = Date.now();
const { wrap, events } = require('../').tradle;
const { putEvent } = events;
exports.handler = wrap(function* (event, context) {
    yield putEvent(event);
});
//# sourceMappingURL=createevent.js.map