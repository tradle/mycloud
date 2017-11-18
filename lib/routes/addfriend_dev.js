"use strict";
const bodyParser = require("body-parser");
const cors = require("cors");
const helmet = require("helmet");
const coexpress = require("co-express");
const add_friend_1 = require("../lambda/add-friend");
const utils_1 = require("../utils");
module.exports = function attachHandler({ tradle, router }) {
    router.use(cors());
    router.use(helmet());
    router.use(bodyParser.json({ limit: '10mb' }));
    router.post('/addfriend', coexpress(function* (req, res) {
        const result = yield utils_1.promisify(add_friend_1.handler)(req.body, tradle.env.context);
        if (result && typeof result === 'object') {
            res.json(result);
        }
        else {
            res.end();
        }
    }));
};
//# sourceMappingURL=addfriend_dev.js.map