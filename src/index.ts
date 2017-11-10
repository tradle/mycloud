import { requireDefault } from './require-default'
import Tradle from './tradle'
import Env from './env'

let tradle

export = {
  // proxy to default instance props
  get tradle():Tradle {
    if (!tradle) {
      const { Tradle } = module.exports
      tradle = new Tradle()
    }

    return tradle
  },
  get env():Env {
    return module.exports.tradle.env
  },

  // sub-modules
  get Tradle() {
    return requireDefault('./tradle')
  },
  get Env() {
    return requireDefault('./env')
  },
  get Identities() {
    return requireDefault('./identities')
  },
  get Provider() {
    return requireDefault('./provider')
  },
  get Auth() {
    return requireDefault('./auth')
  },
  get Objects() {
    return requireDefault('./objects')
  },
  get Buckets() {
    return requireDefault('./buckets')
  },
  get Tables() {
    return requireDefault('./tables')
  },
  get Secrets() {
    return requireDefault('./secrets')
  },
  get Friends() {
    return requireDefault('./friends')
  },
  get Errors() {
    return requireDefault('./errors')
  },
  get Events() {
    return requireDefault('./events')
  },
  get Init() {
    return requireDefault('./init')
  },
  get aws() {
    return requireDefault('./aws')
  },
  get awsConfig() {
    return requireDefault('./aws-config')
  },
  get ContentAddressedStorage() {
    return requireDefault('./content-addressed-storage')
  },
  get KeyValueTable() {
    return requireDefault('./key-value-table')
  },
  get User() {
    return requireDefault('./user')
  },
  get Messages() {
    return requireDefault('./messages')
  },
  get Router() {
    return requireDefault('./router')
  },
  get Delivery() {
    return requireDefault('./delivery')
  },
  get Discovery() {
    return requireDefault('./discovery')
  },
  get Seals() {
    return requireDefault('./seals')
  },
  get Blockchain() {
    return requireDefault('./blockchain')
  },
  get Iot() {
    return requireDefault('./iot-utils')
  },
  get S3() {
    return requireDefault('./s3-utils')
  },
  get Lambda() {
    return requireDefault('./lambda-utils')
  },
  get dbUtils() {
    return requireDefault('./db-utils')
  },
  get Resources() {
    return requireDefault('./resources')
  },
  get stringUtils() {
    return requireDefault('./string-utils')
  },
  get imageUtils() {
    return requireDefault('./image-utils')
  },
  get configureProvider() {
    return requireDefault('./configure-provider')
  },
  get crypto() {
    return requireDefault('./crypto')
  },
  get utils() {
    return requireDefault('./utils')
  },
  get constants() {
    return requireDefault('./constants')
  },
  get models() {
    return requireDefault('./models')
  },
  get wrap() {
    return requireDefault('./wrap')
  },
  get Bot() {
    return requireDefault('./bot')
  }
}
