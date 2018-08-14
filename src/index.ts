import { requireDefault } from './require-default'
import { createBot as _createBot } from './bot'
import Env from './env'
import {
  LambdaUtils,
  StackUtils,
  AwsApis,
  Bot,
  IBotOpts
} from './types'

let bot

const createTestBot = (opts:Partial<IBotOpts>={}) => _createBot({
  ...opts,
  env: opts.env || require('./test/env').createTestEnv()
})

const createRemoteBot = (opts:Partial<IBotOpts>={}) => _createBot({
  ...opts,
  env: opts.env || require('./cli/remote-service-map')
})

const createBot = (opts:Partial<IBotOpts>={}) => {
  if (opts.env) return _createBot(opts)
  if (process.env.IS_OFFLINE || process.env.IS_LOCAL) {
    require('./test/env').install()
    return createTestBot(opts)
  }

  return _createBot(opts)
}

const exp = {
  // proxy to default instance props
  get bot():Bot {
    if (!bot) {
      bot = createBot()
    }

    return bot
  },
  get env():Env {
    return exp.bot.env
  },
  // sub-modules
  createBot,
  createTestBot,
  createRemoteBot,
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
  get aws():AwsApis {
    return requireDefault('./aws')
  },
  get awsConfig() {
    return requireDefault('./aws-config')
  },
  get ContentAddressedStore() {
    return requireDefault('./content-addressed-store')
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
  get lambdaUtils():LambdaUtils {
    return requireDefault('./lambda-utils')
  },
  get stackUtils():StackUtils {
    return requireDefault('./stack-utils')
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
  }
}

export = exp
