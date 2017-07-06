const querystring = require('querystring')
const debug = require('debug')('λ:recharge:bitcoin')
const request = require('superagent')
const wrap = require('../wrap')
const tradle = require('../')
const PIECES = 2

exports.handler = wrap(function* ({ amount=100000 }) {
  const { object } = yield tradle.provider.getMyIdentity()
  const address = object.pubkeys.find(key => {
    return key.networkName === 'testnet' && key.purpose === 'messaging'
  }).fingerprint

  let qs = querystring.stringify({
    amount: Math.floor(amount / PIECES),
    address
  }) + '&'

  // split funds
  const res = yield request(`https://tbtcfaucet.tradle.io/withdraw?${qs.repeat(PIECES)}`)
  const { ok, body, text } = res
  if (!ok) {
    throw new Error(text)
  }

  return body
})
