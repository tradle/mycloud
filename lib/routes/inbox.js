"use strict";
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const coexpress = require("co-express");
module.exports = function attachHandler({ tradle, router }) {
    const { user, logger } = tradle;
    const inboxHandler = coexpress(function* (req, res) {
        const { messages } = req.body;
        logger.debug(`receiving ${messages.length} messages in inbox`);
        for (const message of messages) {
            try {
                yield user.onSentMessage({ message });
            }
            catch (err) {
                if (err instanceof Errors.Duplicate) {
                    logger.debug('received duplicate');
                    continue;
                }
                throw err;
            }
        }
        logger.debug(`received ${messages.length} messages in inbox`);
        res.json({});
    });
    router.use(cors());
    router.use(helmet());
    router.use(bodyParser.json({ limit: '10mb' }));
    router.put('/inbox', inboxHandler);
    router.post('/inbox', inboxHandler);
};
//# sourceMappingURL=inbox.js.map