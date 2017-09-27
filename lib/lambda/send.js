const wrap = require('../wrap');
const bot = require('../bot');
exports.handler = wrap(function* (event, context) {
    yield bot.send(event);
});
//# sourceMappingURL=send.js.map