const { getRecordsFromEvent } = require('../db-utils');
const { prettify } = require('../string-utils');
exports.handler = function (event, context, cb) {
    console.log('env', process.env);
    console.log('event', process.env);
    if (event.Records) {
        const records = getRecordsFromEvent(event);
        console.log(prettify(records));
    }
    else {
        console.log('event', prettify(event));
    }
    cb(null, event);
};
//# sourceMappingURL=log.js.map