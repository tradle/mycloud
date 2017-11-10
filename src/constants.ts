import {
  TYPE,
  PERMALINK,
  PREVLINK,
  LINK,
  SEQ,
  SIG,
  PREV_TO_RECIPIENT,
  NONCE,
  TYPES
} from '@tradle/constants'

let prefix = ''
// if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
//   const { ORG_NAME } = process.env
//   if (ORG_NAME) prefix = ORG_NAME.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
// }

const constants = {
  TYPE,
  PERMALINK,
  PREVLINK,
  LINK,
  SEQ,
  SIG,
  PREV_TO_RECIPIENT,
  NONCE,
  TYPES: {
    ...TYPES,
    INTRODUCTION: 'tradle.Introduction',
    IDENTITY_PUBLISH_REQUEST: 'tradle.IdentityPublishRequest'
  },
  IDENTITY_KEYS_KEY: prefix + 'keys.json',
  PUBLIC_CONF_BUCKET: {
    info: prefix + 'info.json',
    identity: prefix + 'identity.json',
    style: prefix + 'style.json'
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
  HTTP_METHODS: 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
  WARMUP_SOURCE_NAME: 'warmup',
  WARMUP_SLEEP: 40
}

export = constants
