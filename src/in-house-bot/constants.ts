
import {
  PRIVATE_CONF_BUCKET as defaults
} from '../constants'

export const PRIVATE_CONF_BUCKET = {
  ...defaults,
  bot: 'conf/bot.json',
  style: 'conf/style.json',
  termsAndConditions: 'conf/terms-and-conditions.md',
  org: 'org/org.json',
  info: 'info/info.json'
}

export const MODELS_HASH_PROPERTY = 'modelsHash'
export const STYLES_HASH_PROPERTY = 'stylesHash'

export const TYPES = {
  DATA_CLAIM: 'tradle.DataClaim',
  DATA_BUNDLE: 'tradle.DataBundle',
  FORM: 'tradle.Form',
  VERIFICATION: 'tradle.Verification',
  MY_PRODUCT: 'tradle.MyProduct',
  APPLICATION: 'tradle.Application',
  PRODUCT_REQUEST: 'tradle.ProductRequest'
}
