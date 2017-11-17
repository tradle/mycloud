"use strict";
const coexpress = require("co-express");
const utils_1 = require("../utils");
module.exports = function attachHandler({ tradle, router }) {
    const { init, user, logger } = tradle;
    router.get('/info', coexpress(function* (req, res) {
        logger.debug('[START] /info', utils_1.timestamp());
        yield init.ensureInitialized();
        const result = yield user.onGetInfo();
        res.json(result);
    }));
};
//# sourceMappingURL=info.js.map