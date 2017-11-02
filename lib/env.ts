
import './globals'
import './console'

import yn = require('yn')
import debug = require('debug')
import randomName = require('random-name')
import Networks = require('./networks')
import { parseArn } from './utils'
import { IDebug, ILambdaExecutionContext } from './types'
import { WARMUP_SOURCE_NAME } from './constants'
import Logger, { Level } from './logger'
import { name as packageName } from '../package.json'

export default class Env {
  public TESTING:boolean
  public DEV:boolean
  public IS_WARM_UP:boolean
  public IS_LAMBDA_ENVIRONMENT:boolean
  public IS_LOCAL:boolean
  public IS_OFFLINE:boolean
  public DISABLED:boolean
  public LAMBDA_BIRTH_DATE:number

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
  public STACK_ID:string
  public logger:Logger
  public debug:IDebug
  public event:any
  public context:ILambdaExecutionContext
  public containerId:string
  public requestCtx:any
  public _X_AMZN_TRACE_ID:string
  public isVirgin:boolean
  public get containerAge () {
    return this.LAMBDA_BIRTH_DATE ? Date.now() - this.LAMBDA_BIRTH_DATE : null
  }

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

    const namespace = this.TESTING ? packageName : ''
    this.logger = new Logger({
      namespace,
      context: {},
      level: 'DEBUG_LEVEL' in props ? Number(props.DEBUG_LEVEL) : Level.DEBUG,
      console: this.TESTING
        ? { log: debug(namespace) }
        : global.console,
      outputFormat: this.TESTING ? 'text': 'json'
    })

    this.debug = this.logger.debug
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
  public sublogger = (namespace:string):Logger => {
    // create sub-logger
    return this.logger.logger({ namespace })
  }

  // gets overridden when lambda is attached
  public getRemainingTime = ():number => {
    return Infinity
  }

  public setFromLambdaEvent = ({
    event,
    context,
    source
  }) => {
    if (this.containerId) {
      this.isVirgin = false
    } else {
      this.logger.info('I am a fresh container!')
      this.isVirgin = true
      this.containerId = `${randomName.first()} ${randomName.middle()} ${randomName.last()}`
    }

    if (source === 'lambda' && event.requestContext) {
      this.setRequestContext(event.requestContext)
    }

    context.callbackWaitsForEmptyEventLoop = false

    this.IS_WARM_UP = event.source === WARMUP_SOURCE_NAME
    // if (this.TESTING) {
    //   this.debug('setting TEST resource map')
    //   this.set(require('../test/service-map'))
    // }

    const {
      invokedFunctionArn,
      getRemainingTimeInMillis
    } = context

    let props = {
      event,
      context,
      getRemainingTime: getRemainingTimeInMillis
    }

    if (invokedFunctionArn) {
      const { accountId } = parseArn(invokedFunctionArn)
      props.accountId = accountId
    }

    this.set(props)

    const requestCtx = {
      'correlation-id': context.awsRequestId,
      'container-id': this.containerId
    }

    if (source) {
      requestCtx['correlation-source'] = source
    }

    if (this._X_AMZN_TRACE_ID) {
      requestCtx['trace-id'] = this._X_AMZN_TRACE_ID
    }

    if (this.IS_OFFLINE) {
      requestCtx['function'] = this.FUNCTION_NAME
    }

    this.setRequestContext(requestCtx)
  }

  public setRequestContext(ctx) {
    const prefixed = {}
    for (let key in ctx) {
      if (key.startsWith('x-')) {
        prefixed[key] = ctx[key]
      } else {
        prefixed['x-' + key] = ctx[key]
      }
    }

    this.requestCtx = prefixed
    this.logger.setContext(this.requestCtx)
  }

  public getRequestContext() {
    return { ...this.requestCtx }
  }

  private _recalc = (props:any):void => {
    if ('SERVERLESS_STAGE' in props) {
      this.DEV = !this.SERVERLESS_STAGE.startsWith('prod')
    }

    if ('NO_TIME_TRAVEL' in props) {
      this.NO_TIME_TRAVEL = yn(props.NO_TIME_TRAVEL)
    }

    if ('LAMBDA_BIRTH_DATE' in props) {
      this.LAMBDA_BIRTH_DATE = Number(props.LAMBDA_BIRTH_DATE)
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
