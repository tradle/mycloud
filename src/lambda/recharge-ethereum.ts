process.env.LAMBDA_BIRTH_DATE = Date.now()

const { wrap, blockchain } = require('../').createTradle()
exports.handler = wrap(blockchain.recharge)
