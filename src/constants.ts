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
  PROTOCOL_VERSION,
  TYPES as BASE_TYPES
} from '@tradle/constants'

const unitToMillis = {
  minute: 60000,
  hour: 60 * 60000,
  day: 24 * 60 * 60000,
  month: 30 * 24 * 60 * 60000,
  year: 365 * 24 * 60 * 60000
}

const TYPES = {
  ...BASE_TYPES,
  INTRODUCTION: 'tradle.Introduction',
  IDENTITY_PUBLISH_REQUEST: 'tradle.IdentityPublishRequest',
  SIMPLE_MESSAGE: 'tradle.SimpleMessage',
  BACKLINK_ITEM: 'tradle.BacklinkItem',
  SEAL_STATE: 'tradle.SealState',
  DELIVERY_ERROR: 'tradle.DeliveryError',
  SEALABLE_BATCH: 'tradle.SealableBatch'
}

const UNSIGNED_TYPES = [
  'tradle.IotSession',
  'tradle.PubKey',
  'tradle.products.Customer',
  TYPES.SEAL_STATE,
  TYPES.BACKLINK_ITEM,
  TYPES.DELIVERY_ERROR,
  'tradle.POJO'
]

const DEFAULT_JOB_RUNNER_FUNCTION = 'genericJobRunner'
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
  PROTOCOL_VERSION,
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
  APP_SCHEME: 'tradle://',
  PUSH_SERVER_URL: {
    // dev: 'https://push1.tradle.io',
    dev: 'https://push1-prod.tradle.io',
    prod: 'https://push1-prod.tradle.io'
  },
  WARMUP_SOURCE_NAME: 'warmup',
  WARMUP_SLEEP: 40,
  WARMUP_PERIOD: 5 * unitToMillis.minute,
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
  WARMUP_FUNCTION: DEFAULT_JOB_RUNNER_FUNCTION,
  WARMUP_FUNCTION_SHORT_NAME: 'warmup',
  REINITIALIZE_CONTAINERS_FUNCTION: DEFAULT_JOB_RUNNER_FUNCTION,
  DEFAULT_JOB_RUNNER_FUNCTION,
  SEALPENDING_FUNCTION: DEFAULT_JOB_RUNNER_FUNCTION,
  POLLCHAIN_FUNCTION: DEFAULT_JOB_RUNNER_FUNCTION,
  DELIVERY_RETRY_FUNCTION: DEFAULT_JOB_RUNNER_FUNCTION,
  ROOT_LOGGING_NAMESPACE: 'tradle',
  DEFAULT_REGION: 'us-east-1',
  DATE_ZERO: 0, // 1514764800000 // 2018-01-01 UTC
  UNSIGNED_TYPES,
  FORBIDDEN_PAYLOAD_TYPES: UNSIGNED_TYPES,
  ADMIN_ALERTS_TOPIC_NAME: 'AdminAlerts',
  SIGNATURE_FRESHNESS_LEEWAY: 5 * unitToMillis.minute,
  DEFAULT_SESSION_TTL_SECONDS: 3600,
  MAX_SESSION_TTL_SECONDS: 3600,
  MIN_SESSION_TTL_SECONDS: 900,
  MAX_DELIVERY_ATTEMPTS: 20,
  BATCH_SEALING_PROTOCOL_VERSION: 'v1',
  TRADLE: {
    API_BASE_URL: 'https://t22ju1ga5c.execute-api.us-east-1.amazonaws.com/dev',
    PERMALINK: '9658992cbb1499c1fd9f7d92e1dee43eb65f403b3a32f2d888d2f241c4bdf7b6',
    ORG_NAME: 'Tradle',
    ACCOUNT_ID: '210041114155'
  }
}

export = constants
