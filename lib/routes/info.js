"use strict";
const coexpress = require("co-express");
const cors = require("cors");
const helmet = require("helmet");
const utils_1 = require("../utils");
module.exports = function attachHandler({ tradle, router }) {
    const { init, user, logger } = tradle;
    router.use(cors());
    router.use(helmet());
    router.get('/info', coexpress(function* (req, res) {
        logger.debug('[START] /info', utils_1.timestamp());
        yield init.ensureInitialized();
        logger.debug('initialized');
        const result = yield user.onGetInfo();
        logger.debug('got result');
        res.json(result);
    }));
};
//# sourceMappingURL=info.js.map