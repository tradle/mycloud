
import {
  PRIVATE_CONF_BUCKET as defaults,
  TYPES as BASE_TYPES
} from '../constants'

export const PRIVATE_CONF_BUCKET = {
  ...defaults,
  bot: 'conf/bot.json',
  style: 'conf/style.json',
  termsAndConditions: 'conf/terms-and-conditions.md',
  org: 'org/org.json',
  info: 'info/info.json',
}

export const MODELS_HASH_PROPERTY = 'modelsHash'
export const STYLES_HASH_PROPERTY = 'stylesHash'

export const TYPES = {
  ...BASE_TYPES,
  DATA_CLAIM: 'tradle.DataClaim',
  DATA_BUNDLE: 'tradle.DataBundle',
  FORM: 'tradle.Form',
  VERIFICATION: 'tradle.Verification',
  MY_PRODUCT: 'tradle.MyProduct',
  APPLICATION: 'tradle.Application',
  PRODUCT_REQUEST: 'tradle.ProductRequest',
  DRAFT_APPLICATION: 'tradle.DraftApplication',
  FORM_PREFILL: 'tradle.FormPrefill',
  DEPLOYMENT_PRODUCT: 'tradle.cloud.Deployment',
  DEPLOYMENT_CONFIG_FORM: 'tradle.cloud.Configuration',
  ORGANIZATION: 'tradle.Organization',
  STYLES_PACK: 'tradle.StylesPack',
}

export const TRADLE = {
  API_BASE_URL: 'https://t22ju1ga5c.execute-api.us-east-1.amazonaws.com/dev',
  PERMALINK: '9658992cbb1499c1fd9f7d92e1dee43eb65f403b3a32f2d888d2f241c4bdf7b6',
  ORG_NAME: 'Tradle',
  ACCOUNT_ID: '210041114155',
}
