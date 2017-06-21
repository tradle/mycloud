const clone = require('xtend')
const pick = require('xtend/mutable')
const { splitCamelCase } = require('./string-utils')
const env = clone(
  require('../../env'),
  process.env
)

env.BLOCKCHAIN = (function () {
  const { BLOCKCHAIN='bitcoin:testnet' } = env
  const [flavor, networkName] = BLOCKCHAIN.split(':')
  return {
    flavor,
    networkName,
    toString: () => BLOCKCHAIN,
    select: obj => obj[flavor]
  }
}())

env.DEV = env.SERVERLESS_STAGE === 'dev'

for (let prop in process.env) {
  if (prop.slice(0, 3) === 'CF_') {
    let split = splitCamelCase(prop.slice(3), '_').toUpperCase()
    env[split] = process.env[prop]
  }
}

module.exports = env
