import {
  TYPE,
  PERMALINK,
  PREVLINK,
  PREVHEADER,
  LINK,
  OWNER,
  SEQ,
  SIG,
  WITNESSES,
  PREV_TO_RECIPIENT,
  NONCE,
  AUTHOR,
  RECIPIENT,
  ORG,
  ORG_SIG,
  TIMESTAMP,
  VERSION,
  TYPES as BASE_TYPES,
} from '@tradle/constants'

const unitToMillis = {
  minute: 60000,
  hour: 60 * 60000,
  day: 24 * 60 * 60000,
  month: 30 * 24 * 60 * 60000,
  year: 365 * 24 * 60 * 60000,
}

const TYPES = {
  ...BASE_TYPES,
  INTRODUCTION: 'tradle.Introduction',
  IDENTITY_PUBLISH_REQUEST: 'tradle.IdentityPublishRequest',
  SIMPLE_MESSAGE: 'tradle.SimpleMessage',
  BACKLINK_ITEM: 'tradle.BacklinkItem',
  SEAL_STATE: 'tradle.SealState',
  DELIVERY_ERROR: 'tradle.DeliveryError',
}

const UNSIGNED_TYPES = [
  'tradle.IotSession',
  'tradle.MyCloudFriend',
  'tradle.PubKey',
  'tradle.products.Customer',
  TYPES.SEAL_STATE,
  TYPES.BACKLINK_ITEM,
  TYPES.DELIVERY_ERROR,
  'tradle.POJO'
]

const constants = {
  ORG,
  ORG_SIG,
  TYPE,
  PERMALINK,
  PREVLINK,
  PREVHEADER,
  OWNER,
  LINK,
  SEQ,
  SIG,
  WITNESSES,
  PREV_TO_RECIPIENT,
  NONCE,
  AUTHOR,
  RECIPIENT,
  TIMESTAMP,
  VERSION,
  TYPES,
  IDENTITY_KEYS_KEY: 'keys.json',
  PRIVATE_CONF_BUCKET: {
    identity: 'identity.json',
    modelsPack: 'derived/cumulative-models-pack.json',
    graphqlSchema: 'derived/cumulative-graphql-schema.json',
    assetsFolder: 'assets',
    myModelsPack: 'conf/models-pack.json'
  },
  // SECRETS_BUCKET: {
  //   identityFolder: 'identity'
  // },
  HANDSHAKE_TIMEOUT: 30000,
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
  WEB_APP_URL: 'https://app.tradle.io',
  MOBILE_APP_URL: 'https://link.tradle.io',
  PUSH_SERVER_URL: {
    // dev: 'https://push1.tradle.io',
    dev: 'https://push1-prod.tradle.io',
    prod: 'https://push1-prod.tradle.io'
  },
  DEFAULT_WARMUP_EVENT: {
    concurrency: 5,
    functions: [
      'oniotlifecycle',
      'onmessage',
      'onresourcestream',
      'graphql',
      'info',
      'preauth',
      'auth',
      'inbox'
    ]
  },
  ROOT_LOGGING_NAMESPACE: 'tradle',
  DEFAULT_REGION: 'us-east-1',
  DATE_ZERO: 0, // 1514764800000 // 2018-01-01 UTC
  UNSIGNED_TYPES,
  FORBIDDEN_PAYLOAD_TYPES: UNSIGNED_TYPES,
  TRADLE_MYCLOUD_URL: 'https://t22ju1ga5c.execute-api.us-east-1.amazonaws.com/dev',
  TRADLE_PERMALINK: '9658992cbb1499c1fd9f7d92e1dee43eb65f403b3a32f2d888d2f241c4bdf7b6'
}

export = constants
