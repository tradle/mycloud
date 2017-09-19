const deepExtend = require('deep-extend')
const tradleConstants = require('@tradle/constants')

module.exports = deepExtend({
  "TYPES": {
    "INTRODUCTION": "tradle.Introduction"
  },
  "IDENTITY_KEYS_KEY": "keys.json",
  "PUBLIC_CONF_BUCKET": {
    "info": "info.json",
    "identity": "identity.json",
    "style": "style.json"
  },
  "HANDSHAKE_TIMEOUT": 30000,
  "PUSH_SERVER_URL": "https://push1.tradle.io",
  "WEBHOOKS": {
    "initialDelay": 1000,
    "maxDelay": 300000,
    "maxRetries": 100
  },
  "MAX_CLOCK_DRIFT": 10000,
  "BLOCKCHAIN": {
    "ethereum:ropsten": {
      // 2 ether
      "minBalance": "2000000000000000000"
    },
    "ethereum:rinkeby": {
      // 2 ether
      "minBalance": "2000000000000000000"
    },
    "bitcoin:testnet": {
      // 0.01 bitcoin
      "minBalance": 1000000
    }
  }
}, tradleConstants)
