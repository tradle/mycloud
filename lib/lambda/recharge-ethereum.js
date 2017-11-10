process.env.LAMBDA_BIRTH_DATE = Date.now();
const { wrap, blockchain } = require('../').tradle;
exports.handler = wrap(blockchain.recharge);
//# sourceMappingURL=recharge-ethereum.js.map