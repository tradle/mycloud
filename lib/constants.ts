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
  HTTP_METHODS: 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
  TABLES_TO_PRECREATE: [
    'tradle.Application',
    'tradle.AssignRelationshipManager',
    'tradle.FormRequest',
    'tradle.ProductRequest',
    'tradle.Verification',
    'tradle.CustomerWaiting',
    'tradle.Introduction',
    'tradle.SelfIntroduction',
    'tradle.IdentityPublishRequest',
    'tradle.ApplicationApproval',
    'tradle.ApplicationDenial',
    'tradle.Name',
    'tradle.SimpleMessage',
    'tradle.MyEmployeeOnboarding',
    'tradle.MyCloudFriend',
    'tradle.ForgetMe',
    'tradle.ForgotYou',
    'tradle.ModelsPack',
    'tradle.ShareRequest'
  ],
  WARMUP_SOURCE_NAME: 'warmup'
}

export = constants
