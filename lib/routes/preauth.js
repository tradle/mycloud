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
    router.post('/preauth', coexpress(function* (req, res) {
        yield init.ensureInitialized();
        const { clientId, identity } = req.body;
        const { accountId } = req.event.requestContext;
        const session = yield user.onPreAuth({ accountId, clientId, identity });
        res.json(session);
    }));
};
//# sourceMappingURL=preauth.js.map