"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../init-lambda");
const { wrap, blockchain } = require('../').tradle;
exports.handler = wrap(blockchain.recharge);
//# sourceMappingURL=recharge-ethereum.js.map