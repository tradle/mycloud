import { PRIVATE_CONF_BUCKET as defaults, TYPES as BASE_TYPES, TRADLE } from '../constants'
export { TRADLE }
export const PRIVATE_CONF_BUCKET = {
  ...defaults,
  bot: 'conf/bot.json',
  style: 'conf/style.json',
  termsAndConditions: 'conf/terms-and-conditions.md',
  org: 'org/org.json',
  info: 'info/info.json',
  kycServiceDiscovery: 'discovery/ecs-services.json'
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
  APPLICATION_SUBMISSION: 'tradle.ApplicationSubmission',
  PRODUCT_REQUEST: 'tradle.ProductRequest',
  DRAFT_APPLICATION: 'tradle.DraftApplication',
  FORM_PREFILL: 'tradle.FormPrefill',
  DEPLOYMENT_PRODUCT: 'tradle.cloud.Deployment',
  DEPLOYMENT_CONFIG_FORM: 'tradle.cloud.Configuration',
  ORGANIZATION: 'tradle.Organization',
  STYLES_PACK: 'tradle.StylesPack',
  MY_EMPLOYEE_ONBOARDING: 'tradle.MyEmployeeOnboarding',
  ASSIGN_RELATIONSHIP_MANAGER: 'tradle.AssignRelationshipManager'
}
