const deepExtend = require('deep-extend')
const tradleConstants = require('@tradle/constants')

module.exports = deepExtend({
  TYPES: {
    INTRODUCTION: 'tradle.Introduction'
  },
  IDENTITY_KEYS_KEY: 'keys.json',
  PUBLIC_CONF_BUCKET: {
    info: 'info.json',
    identity: 'identity.json',
    style: 'style.json'
  },
  HANDSHAKE_TIMEOUT: 30000,
  PUSH_SERVER_URL: 'https://push1.tradle.io',
  WEBHOOKS: {
    initialDelay: 1000,
    maxDelay: 300000,
    maxRetries: 100
  },
  MAX_CLOCK_DRIFT: 10000,
  MAX_DB_ITEM_SIZE: 6000,
  ENV_RESOURCE_PREFIX: 'R_',
  HTTP_METHODS: 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT'
}, tradleConstants)
