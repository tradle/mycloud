
import './globals'
// import './console'

import yn from 'yn'
import debug from 'debug'
import randomName from 'random-name'
import { allSettled, RESOLVED_PROMISE } from './utils'
import { randomString } from './crypto'
import {
  IDebug,
  ILambdaAWSExecutionContext,
  Lambda,
  IRequestContext,
  CloudName,
  IBlockchainIdentifier
} from './types'
import { WARMUP_SOURCE_NAME, ROOT_LOGGING_NAMESPACE } from './constants'
import Logger, { Level } from './logger'

export default class Env {
  public lambda:Lambda
  public reqCtx:IRequestContext
  public TESTING:boolean
  public DEV:boolean
  public IS_WARM_UP:boolean
  public IS_LAMBDA_ENVIRONMENT:boolean
  // if either IS_LOCAL, or IS_OFFLINE is true
  // operations will be performed on local resources
  // is running locally (not in lambda)
  public IS_LOCAL:boolean
  // is running in serverless-offline
  public IS_OFFLINE:boolean
  public SERVERLESS_OFFLINE_PORT: number
  public SERVERLESS_OFFLINE_APIGW: string
  public DISABLED:boolean

  public CLOUD: CloudName
  public AWS_REGION:string
  public REGION:string
  public AWS_LAMBDA_FUNCTION_NAME:string
  public FUNCTION_NAME:string
  public MEMORY_SIZE:number
  public DEBUG_FORMAT:string
  public DEBUG_LEVEL:string

  public SERVERLESS_PREFIX:string
  public SERVERLESS_STAGE:string
  public SERVERLESS_SERVICE_NAME:string
  public SERVERLESS_ALIAS?:string
  public SERVERLESS_ARTIFACTS_PATH: string
  public get STAGE() {
    return this.SERVERLESS_STAGE
  }

  public get SERVICE_NAME() {
    return this.SERVERLESS_SERVICE_NAME
  }

  public get ALIAS() {
    return this.SERVERLESS_ALIAS
  }

  public get STACK_NAME() {
    return `${this.SERVERLESS_SERVICE_NAME}-${this.STAGE}`
  }

  public BLOCKCHAIN: IBlockchainIdentifier
  public CORDA_API_URL?:string
  public CORDA_API_KEY?:string
  public NO_TIME_TRAVEL:boolean
  public IOT_PARENT_TOPIC:string
  public IOT_ENDPOINT:string
  public logger:Logger
  public debug:IDebug
  public _X_AMZN_TRACE_ID:string
  public accountId: string

  private nick:string
  constructor(props:any) {
    const {
      SERVERLESS_PREFIX,
      SERVERLESS_STAGE,
      SERVERLESS_SERVICE_NAME,
      NODE_ENV,
      IS_LOCAL,
      IS_OFFLINE,
      AWS_REGION,
      AWS_LAMBDA_FUNCTION_NAME,
      AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
      NO_TIME_TRAVEL,
      BLOCKCHAIN
    } = props

    if (AWS_LAMBDA_FUNCTION_NAME) {
      this.CLOUD = 'aws'
    }

    this.TESTING = NODE_ENV === 'test' || yn(IS_LOCAL) || yn(IS_OFFLINE)
    this.FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME
      ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
      : '[unknown]'

    this.MEMORY_SIZE = isNaN(AWS_LAMBDA_FUNCTION_MEMORY_SIZE)
      ? 512
      : Number(AWS_LAMBDA_FUNCTION_MEMORY_SIZE)

    this.SERVERLESS_ARTIFACTS_PATH = `serverless/${SERVERLESS_SERVICE_NAME}/${SERVERLESS_STAGE}`

    this.logger = new Logger({
      namespace: ROOT_LOGGING_NAMESPACE,
      writer: global.console,
      // writer: this.TESTING ? { log: debug(`lambda:${this.FUNCTION_NAME}`) } : global.console,
      outputFormat: props.DEBUG_FORMAT || 'text',
      context: {},
      level: 'DEBUG_LEVEL' in props ? Number(props.DEBUG_LEVEL) : Level.DEBUG,
      // writer: console,
      // outputFormat: 'text'
    })

    this.debug = this.logger.debug
    this.set(props)
    // this.asyncTasks = []
  }

  public set = props => {
    Object.assign(this, props)
    this._recalc(props)
  }

  public get = () => {
    return JSON.stringify(this)
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
    return this.lambda ? this.lambda.timeLeft : 0
  }

  public setLambda = (lambda) => {
    this.lambda = lambda
    this.setRequestContext(lambda.reqCtx)
    const { event, context } = lambda.execCtx
    this.IS_WARM_UP = event.source === WARMUP_SOURCE_NAME
    this.set({ accountId: lambda.accountId })
  }

  public setRequestContext(ctx) {
    // const prefixed = {}
    // for (let key in ctx) {
    //   if (key.startsWith('x-')) {
    //     prefixed[key] = ctx[key]
    //   } else {
    //     prefixed['x-' + key] = ctx[key]
    //   }
    // }

    // this.reqCtx = prefixed
    this.reqCtx = ctx
    this.logger.setContext(this.reqCtx)
  }

  public getRequestContext() {
    return { ...this.reqCtx }
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
      this.BLOCKCHAIN = { flavor, networkName }
    }
  }
}

export { Env }
