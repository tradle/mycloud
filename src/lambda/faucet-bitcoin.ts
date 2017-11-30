import '../init-lambda'

const debug = require('debug')('λ:faucet.bitcoin')
const { wrap, faucet } = require('../').tradle
exports.withdraw = wrap(function* ({ to, fee }) {
  const total = to.reduce((total, next) => total + next.amount, 0)
  if (total > 1e7) {
      throw new Error('the limit per withdrawal is 0.1 bitcoin')
  }

  yield faucet.withdraw({ to, fee })
})
