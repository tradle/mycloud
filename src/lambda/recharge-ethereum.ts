import '../init-lambda'

const { wrap, blockchain } = require('../').tradle
exports.handler = wrap(blockchain.recharge)
