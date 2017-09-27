const debug = require('debug')('λ:inbox-events');
const replicator = require('../replicator');
// replicate Inbox to Events
exports.handler = replicator.toEvents(item => {
    return {
        topic: 'receive',
        data: item
    };
});
//# sourceMappingURL=inbox-events.js.map