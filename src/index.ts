import { requireDefault } from './require-default'
import Tradle from './tradle'
import Env from './env'

let tradle

const createTestTradle = (env) => {
  return new Tradle(env || require('./test/env').createTestEnv())
}

const createRemoteTradle = (env) => {
  return new Tradle(env || require('./cli/remote-service-map'))
}

const createTradle = env => {
  if (env) return new Tradle(env)
  if (process.env.IS_OFFLINE || process.env.IS_LOCAL) {
    require('./test/env').install()
    return createTestTradle()
  }

  return new Tradle()
}

const exp = {
  // proxy to default instance props
  get tradle():Tradle {
    if (!tradle) {
      tradle = createTradle()
    }

    return tradle
  },
  get env():Env {
    return exp.tradle.env
  },
  // sub-modules
  createTradle,
  createTestTradle,
  createRemoteTradle,
  get Tradle() {
    return requireDefault('./tradle')
  },
  get Env() {
    return requireDefault('./env')
  },
  get Lambda() {
    return requireDefault('./lambda')
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
  // get Router() {
  //   return requireDefault('./router')
  // },
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
  get lambdaUtils() {
    return requireDefault('./lambda-utils')
  },
  get dbUtils() {
    return requireDefault('./db-utils')
  },
  get ServiceMap() {
    return requireDefault('./service-map')
  },
  get stringUtils() {
    return requireDefault('./string-utils')
  },
  get imageUtils() {
    return requireDefault('./image-utils')
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
  get Bot() {
    return requireDefault('./bot')
  }
}

export = exp
