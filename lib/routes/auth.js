"use strict";
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const coexpress = require("co-express");
module.exports = function attachHandler({ tradle, router }) {
    const { init, user, logger } = tradle;
    router.use(cors());
    router.use(helmet());
    router.use(bodyParser.json({ limit: '10mb' }));
    router.post('/auth', coexpress(function* (req, res) {
        const event = req.body;
        const result = yield user.onSentChallengeResponse(req.body);
        res.json(result);
    }));
};
//# sourceMappingURL=auth.js.map