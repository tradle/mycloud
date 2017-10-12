import { requireDefault } from './require-default'

let tradle

module.exports = {
  // proxy to default instance props
  get tradle() {
    if (!tradle) {
      const { Tradle } = module.exports
      tradle = new Tradle()
    }

    return tradle
  },
  get env () {
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
  get DB() {
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
