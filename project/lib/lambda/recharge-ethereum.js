const debug = require('debug')('λ:recharge:ethereum')
const request = require('superagent')
const wrap = require('../wrap')
const { provider, env } = require('../')
const { BLOCKCHAIN } = env

exports.handler = wrap(function* () {
  const identity = yield provider.getMyIdentity()
  const key = identity.pubkeys.find(key => {
    return key.type === BLOCKCHAIN.flavor &&
      key.networkName === BLOCKCHAIN.networkName &&
      key.purpose === 'messaging'
  })

  if (!key) {
    throw new Error(`no key found for blockchain network ${BLOCKCHAIN.toString()}`)
  }

  const address = key.fingerprint
  const res = yield request(`http://faucet.ropsten.be:3001/donate/${address}`)
  const { ok, body, text } = res
  if (!ok) {
    throw new Error(text)
  }

  return body
})
