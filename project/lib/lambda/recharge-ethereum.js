// const debug = require('debug')('λ:recharge:ethereum')
const wrap = require('../wrap')
const { blockchain } = require('../')

exports.handler = wrap(blockchain.recharge)
