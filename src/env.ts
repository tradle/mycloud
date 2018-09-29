
import './globals'
// import './console'

import clone from 'lodash/clone'
import yn from 'yn'
import debug from 'debug'
import {
  IDebug,
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
  // public TESTING:boolean
  public DEV:boolean
  // if either IS_LOCAL, or IS_OFFLINE is true
  // operations will be performed on local resources
  // is running locally (not in lambda)
  // public IS_LOCAL:boolean
  // is running in serverless-offline
  // public IS_OFFLINE:boolean
  public IS_EMULATED: boolean
  public IS_LOCAL: boolean
  public IS_TESTING: boolean
  public SERVERLESS_OFFLINE_PORT: number
  public SERVERLESS_OFFLINE_APIGW: string
  public S3_PUBLIC_FACING_HOST: string
  public DISABLED:boolean

  public CLOUD: CloudName
  public AWS_REGION:string
  public REGION:string
  public AWS_LAMBDA_FUNCTION_NAME:string
  public FUNCTION_NAME:string
  // public MEMORY_SIZE:number
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
  public IOT_CLIENT_ID_PREFIX:string
  public IOT_ENDPOINT:string
  public logger:Logger
  public debug:IDebug
  public _X_AMZN_TRACE_ID:string
  public AWS_ACCOUNT_ID: string

  constructor(props:any) {
    props = clone(props)
    const {
      SERVERLESS_PREFIX,
      SERVERLESS_STAGE,
      SERVERLESS_SERVICE_NAME,
      NODE_ENV,
      IS_LOCAL,
      IS_OFFLINE,
      AWS_REGION,
      AWS_LAMBDA_FUNCTION_NAME,
      // AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
      NO_TIME_TRAVEL,
      BLOCKCHAIN
    } = props

    if (AWS_LAMBDA_FUNCTION_NAME) {
      props.CLOUD = 'aws'
    }

    props.IS_LOCAL = yn(IS_LOCAL) || yn(IS_OFFLINE)
    props.IS_EMULATED = yn(IS_OFFLINE)
    props.IS_TESTING = NODE_ENV === 'test'
    props.FUNCTION_NAME = AWS_LAMBDA_FUNCTION_NAME
      ? AWS_LAMBDA_FUNCTION_NAME.slice(SERVERLESS_PREFIX.length)
      : 'unknown'

    // props.MEMORY_SIZE = isNaN(AWS_LAMBDA_FUNCTION_MEMORY_SIZE)
    //   ? 512
    //   : Number(AWS_LAMBDA_FUNCTION_MEMORY_SIZE)

    props.SERVERLESS_ARTIFACTS_PATH = `serverless/${SERVERLESS_SERVICE_NAME}/${SERVERLESS_STAGE}`

    this.logger = new Logger({
      namespace: props.IS_TESTING ? '' : ROOT_LOGGING_NAMESPACE,
      // writer: global.console,
      writer: props.IS_TESTING ? createTestingLogger(ROOT_LOGGING_NAMESPACE) : global.console,
      outputFormat: props.DEBUG_FORMAT || 'text',
      context: {},
      level: 'DEBUG_LEVEL' in props ? Number(props.DEBUG_LEVEL) : Level.DEBUG,
      // writer: console,
      // outputFormat: 'text'
    })

    this.debug = this.logger.debug
    this.set(props)

    // shame to do this here as it's a global settings
    if (props.DEBUG) {
      debug.enable(props.DEBUG)
    }

    // this.asyncTasks = []
  }

  public get xraySegment() { return this.lambda.xraySegment }

  public set = props => {
    Object.assign(this, props)
    this._recalc(props)
  }

  public get = () => {
    return JSON.stringify(this)
  }

  public sublogger = (namespace:string):Logger => {
    // create sub-logger
    return this.logger.logger({ namespace })
  }

  // gets overridden when lambda is attached
  public getRemainingTime = ():number => {
    return this.lambda ? this.lambda.timeLeft : 0
  }

  public getRemainingTimeWithBuffer = (buffer: number) => {
    return this.lambda ? this.lambda.getRemainingTimeWithBuffer(buffer) : 0
  }

  public setLambda = (lambda) => {
    this.lambda = lambda
    this.setRequestContext(lambda.reqCtx)
    const { event, context } = lambda.execCtx
    this.set({ AWS_ACCOUNT_ID: lambda.accountId })
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
    // this.logger.setContext(this.reqCtx)
  }

  public getRequestContext() {
    return { ...this.reqCtx }
  }

  public getStackResourceShortName = (name: string):string => {
    return name.slice(this.SERVERLESS_PREFIX.length)
  }

  public getStackResourceName = (name: string):string => {
    const { SERVERLESS_PREFIX='' } = this
    return name.startsWith(SERVERLESS_PREFIX)
      ? name
      : `${SERVERLESS_PREFIX}${name}`
  }

  private _recalc = (props:any):void => {
    if ('SERVERLESS_STAGE' in props) {
      this.DEV = !this.SERVERLESS_STAGE.startsWith('prod')
    }

    if ('NO_TIME_TRAVEL' in props) {
      this.NO_TIME_TRAVEL = yn(props.NO_TIME_TRAVEL)
    }

    this.REGION = this.AWS_REGION
    if ('BLOCKCHAIN' in props) {
      const [blockchain, networkName] = props.BLOCKCHAIN.split(':')
      this.BLOCKCHAIN = { blockchain, networkName }
    }
  }
}

export { Env }

let installedTestEnv

export const createEnv = (props:any={}) => {
  if (!installedTestEnv && process.env.IS_OFFLINE || process.env.IS_LOCAL) {
    installedTestEnv = true
    require('./test/env').install()
  }

  return new Env({ ...process.env, ...props })
}

const createTestingLogger = (name?: string) => {
  const prefix = name ? name + ':' : ''
  return {
    log: debug(`${prefix}`),
    error: debug(`ERROR:${prefix}`),
    warn: debug(`WARN:${prefix}`),
    info: debug(`INFO:${prefix}`),
    debug: debug(`DEBUG:${prefix}`),
    silly: debug(`SILLY:${prefix}`),
    ridiculous: debug(`RIDICULOUS:${prefix}`),
  }
}
