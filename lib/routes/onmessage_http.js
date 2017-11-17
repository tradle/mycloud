"use strict";
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const coexpress = require("co-express");
module.exports = function attachHandler({ tradle, router }) {
    const { user, logger } = tradle;
    const messageHandler = coexpress(function* (req, res) {
        const event = req.body;
        const { message } = event;
        const result = yield user.onSentMessage({ message });
        res.json(result);
    });
    router.use(cors());
    router.use(helmet());
    router.use(bodyParser.json({ limit: '10mb' }));
    router.post('/message', messageHandler);
    router.put('/message', messageHandler);
};
//# sourceMappingURL=onmessage_http.js.map