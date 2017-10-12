
import './globals'
import * as createLogger from 'debug'

import * as yn from 'yn'
import * as Networks from './networks'
import { parseArn } from './utils'

export default class Env {
  public TESTING:boolean
  public DEV:boolean
  public IS_WARM_UP:boolean
  public IS_LAMBDA_ENVIRONMENT:boolean
  public IS_LOCAL:boolean
  public DISABLED:boolean

  public AWS_REGION:string
  public REGION:string
  public AWS_LAMBDA_FUNCTION_NAME:string
  public FUNCTION_NAME:string

  public SERVERLESS_PREFIX:string
  public SERVERLESS_STAGE:string
  public SERVERLESS_SERVICE_NAME:string

  public BLOCKCHAIN:any
  public NO_TIME_TRAVEL:boolean
  public IOT_TOPIC_PREFIX:string
  public IOT_ENDPOINT:string

  private debug:(...any) => void
  private nick:string
  constructor(props:any) {
    this.set(props)

    const {
      SERVERLESS_PREFIX,
      SERVERLESS_STAGE='',
      NODE_ENV,
      IS_LOCAL,
      IS_OFFLINE,
      AWS_REGION,
      AWS_LAMBDA_FUNCTION_NAME,
      NO_TIME_TRAVEL,
      BLOCKCHAIN='ethereum:rinkeby'
    } = props

    this.TESTING = NODE_ENV === 'test' || yn(IS_LOCAL) || yn(IS_OFFLINE)
    this.FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME || '[unknown]'
    const shortName = AWS_LAMBDA_FUNCTION_NAME
      ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
      : '[unknown]'

    this.setDebugNamespace(shortName)
    if (this.TESTING) {
      this.debug('setting TEST resource map')
      require('../test/env').install(this)
    }

    const [flavor, networkName] = BLOCKCHAIN.split(':')
    this.BLOCKCHAIN = Networks[flavor][networkName]
    // serverless-offline plugin sets IS_OFFLINE

    this.DEV = !SERVERLESS_STAGE.startsWith('prod')
    this.NO_TIME_TRAVEL = yn(NO_TIME_TRAVEL)
    this.REGION = this.AWS_REGION
    this.IS_LAMBDA_ENVIRONMENT = !!AWS_REGION
  }

  public set = props => Object.assign(this, props)

  /**
   * Dynamically change logger namespace as "nick" is set lazily, e.g. from router
   */
  public logger = (namespace:string) => {
    let logger = createLogger(`λ:${this.nick}:${namespace}`)
    let currentNick = this.nick
    return (...args) => {
      if (currentNick !== this.nick) {
        currentNick = this.nick
        logger = createLogger(`λ:${this.nick}:${namespace}`)
      }

      return logger(...args)
    }
  }

  public setDebugNamespace = (nickname:string) => {
    this.nick = nickname
    this.debug = createLogger(`λ:${nickname}`)
  }

  public setFromLambdaEvent = (event, context) => {
    this.IS_WARM_UP = event.source === 'serverless-plugin-warmup'
    if (this.TESTING) {
      this.debug('setting TEST resource map')
      this.set(require('../test/service-map'))
    }

    const { invokedFunctionArn } = context
    if (invokedFunctionArn) {
      const {
        accountId
      } = parseArn(invokedFunctionArn)

      this.set({ accountId })
    }
  }
}

// const env = {}
// env.IS_LAMBDA_ENVIRONMENT = !!process.env.AWS_REGION
// if (TESTING) {
//   extend(process.env, require('../test/service-map'))
// } else if (!env.IS_LAMBDA_ENVIRONMENT) {
//   require('./cli/utils').loadCredentials()
//   try {
//     extend(process.env, require('../test/fixtures/remote-service-map'))
//   } catch (err) {}
// }

// env.set(process.env)
// env.REGION = env.AWS_REGION
// env.TESTING = TESTING
// env.prefix = env.SERVERLESS_PREFIX

// this one might be set dynamically
// env.__defineGetter__('IOT_ENDPOINT', () => process.env.IOT_ENDPOINT)


// module.exports = env
