process.env.LAMBDA_BIRTH_DATE = Date.now();
const { wrap, events } = require('../').createTradle();
const { putEvent } = events;
exports.handler = wrap(function* (event, context) {
    yield putEvent(event);
});
//# sourceMappingURL=createevent.js.map