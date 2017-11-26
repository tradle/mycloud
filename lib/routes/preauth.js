"use strict";
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const coexpress = require("co-express");
const utils_1 = require("../utils");
module.exports = function attachHandler({ tradle, router }) {
    const { init, user, logger } = tradle;
    router.use(cors());
    router.use(helmet());
    router.use(bodyParser.json({ limit: '10mb' }));
    router.post('/preauth', coexpress(function* (req, res) {
        const ips = utils_1.getRequestIps(req);
        const { clientId, identity } = req.body;
        const { accountId } = req.event.requestContext;
        const session = yield user.onPreAuth({ accountId, clientId, identity, ips });
        res.json(session);
    }));
};
//# sourceMappingURL=preauth.js.map