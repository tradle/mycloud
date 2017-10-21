
import './globals'
import * as createLogger from 'debug'

import * as yn from 'yn'
import * as Networks from './networks'
import { parseArn } from './utils'
import { IDebug } from './types'
import { WARMUP_SOURCE_NAME } from './constants'

export default class Env {
  public TESTING:boolean
  public DEV:boolean
  public IS_WARM_UP:boolean
  public IS_LAMBDA_ENVIRONMENT:boolean
  public IS_LOCAL:boolean
  public IS_OFFLINE:boolean
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
  public IOT_PARENT_TOPIC:string
  public IOT_ENDPOINT:string
  public debug:IDebug

  private nick:string
  constructor(props:any) {
    const {
      SERVERLESS_PREFIX,
      SERVERLESS_STAGE,
      NODE_ENV,
      IS_LOCAL,
      IS_OFFLINE,
      AWS_REGION,
      AWS_LAMBDA_FUNCTION_NAME,
      NO_TIME_TRAVEL,
      BLOCKCHAIN
    } = props

    this.TESTING = NODE_ENV === 'test' || yn(IS_LOCAL) || yn(IS_OFFLINE)
    this.FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME || '[unknown]'
    const shortName = AWS_LAMBDA_FUNCTION_NAME
      ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
      : '[unknown]'

    this.setDebugNamespace(shortName)
    this.set(props)
    if (this.TESTING) {
      this.debug('setting TEST resource map')
      require('../test/env').install(this)
    }

    // serverless-offline plugin sets IS_OFFLINE
  }

  public set = props => {
    Object.assign(this, props)
    this._recalc(props)
  }

  /**
   * Dynamically change logger namespace as "nick" is set lazily, e.g. from router
   */
  public logger = (namespace:string):IDebug => {
    let logger = createLogger(`λ:${this.nick}:${namespace}`)
    let currentNick = this.nick
    return (...args) => {
      if (currentNick !== this.nick) {
        currentNick = this.nick
        logger = createLogger(`λ:${this.nick}:${namespace}`)
      }

      logger(...args)
    }
  }

  public setDebugNamespace = (nickname:string) => {
    this.nick = nickname
    this.debug = createLogger(`λ:${nickname}`)
  }

  // gets overridden when lambda is attached
  public getRemainingTime = ():number => {
    return Infinity
  }

  public setFromLambdaEvent = (event, context) => {
    this.IS_WARM_UP = event.source === WARMUP_SOURCE_NAME
    if (this.TESTING) {
      this.debug('setting TEST resource map')
      this.set(require('../test/service-map'))
    }

    const {
      invokedFunctionArn,
      getRemainingTimeInMillis
    } = context

    if (invokedFunctionArn) {
      const { accountId } = parseArn(invokedFunctionArn)
      this.set({ accountId })
    }

    this.set({
      event,
      context,
      getRemainingTime: getRemainingTimeInMillis
    })
  }

  private _recalc = (props:any):void => {
    if ('SERVERLESS_STAGE' in props) {
      this.DEV = !this.SERVERLESS_STAGE.startsWith('prod')
    }

    if ('NO_TIME_TRAVEL' in props) {
      this.NO_TIME_TRAVEL = yn(props.NO_TIME_TRAVEL)
    }

    this.REGION = this.AWS_REGION
    if ('IS_LAMBDA_ENVIRONMENT' in props) {
      this.IS_LAMBDA_ENVIRONMENT = yn(props.IS_LAMBDA_ENVIRONMENT)
    } else if (typeof this.IS_LAMBDA_ENVIRONMENT !== 'boolean') {
      this.IS_LAMBDA_ENVIRONMENT = !this.TESTING
    }

    if ('BLOCKCHAIN' in props) {
      const [flavor, networkName] = props.BLOCKCHAIN.split(':')
      this.BLOCKCHAIN = Networks[flavor][networkName]
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
