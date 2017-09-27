process.env.CF_Events = 'Events';
require('../env');
const wrap = require('../wrap');
const { putEvent } = require('../events');
const { extend } = require('../utils');
exports.handler = wrap(function* (event, context) {
    yield putEvent(event);
});
//# sourceMappingURL=createevent.js.map