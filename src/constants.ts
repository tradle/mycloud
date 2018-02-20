import {
  TYPE,
  PERMALINK,
  PREVLINK,
  LINK,
  OWNER,
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

const unitToMillis = {
  minute: 60000,
  hour: 60 * 60000,
  day: 24 * 60 * 60000,
  month: 30 * 24 * 60 * 60000,
  year: 365 * 24 * 60 * 60000,
}

const constants = {
  TYPE,
  PERMALINK,
  PREVLINK,
  OWNER,
  LINK,
  SEQ,
  SIG,
  PREV_TO_RECIPIENT,
  NONCE,
  TYPES: {
    ...TYPES,
    INTRODUCTION: 'tradle.Introduction',
    IDENTITY_PUBLISH_REQUEST: 'tradle.IdentityPublishRequest',
    SIMPLE_MESSAGE: 'tradle.SimpleMessage'
  },
  IDENTITY_KEYS_KEY: prefix + 'keys.json',
  PUBLIC_CONF_BUCKET: {
    identity: prefix + 'identity.json',
  },
  PRIVATE_CONF_BUCKET: {
    modelsPack: 'derived/cumulative-models-pack.json',
    graphqlSchema: 'derived/cumulative-graphql-schema.json',
    assetsFolder: 'assets',
    myModelsPack: 'conf/models-pack.json'
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
  WARMUP_SLEEP: 40,
  UNDELIVERED_STATUS: 'u',
  unitToMillis,
  DB_IGNORE_PAYLOAD_TYPES: {
    inbound: [
      // double-wrapped messages
      'tradle.Message',
      'tradle.CustomerWaiting'
    ],
    outbound: [
      // double-wrapped messages
      'tradle.Message',
      'tradle.CustomerWaiting'
    ]
  },
  LAUNCH_STACK_BASE_URL: 'https://console.aws.amazon.com/cloudformation/home',
  WEB_APP_URL: 'https://app.tradle.io/chat'
}

export = constants
