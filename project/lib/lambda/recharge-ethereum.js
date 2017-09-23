// const debug = require('debug')('λ:recharge:ethereum')
const { wrap, blockchain } = require('../')

exports.handler = wrap(blockchain.recharge)
