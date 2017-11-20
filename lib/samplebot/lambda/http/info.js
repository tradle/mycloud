"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const coexpress = require("co-express");
const cors = require("cors");
const helmet = require("helmet");
const _1 = require("../../../");
const conf_1 = require("../../conf");
const tradle = _1.createTradle();
const { router } = tradle;
const conf = conf_1.createConf({ tradle });
router.use(cors());
router.use(helmet());
router.get('/info', coexpress(function* (req, res) {
    const result = yield conf.publicConf.get();
    result.aws = true;
    result.iotParentTopic = tradle.env.IOT_PARENT_TOPIC;
    res.json(result);
}));
router.use(router.defaultErrorHandler);
exports.handler = tradle.createHttpHandler();
//# sourceMappingURL=info.js.map