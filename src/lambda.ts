// adapted from: https://github.com/Movement-2016/bellman
const dateOfBirth = Date.now()

require('source-map-support').install()

// require('time-require')
import './globals'

import { EventEmitter } from 'events'
import zlib from 'zlib'
import _ from 'lodash'

// @ts-ignore
import Promise from 'bluebird'
import compose from 'koa-compose'
import * as Koa from 'koa'
import caseless from 'caseless'
import randomName from 'random-name'
import AWSXray from 'aws-xray-sdk-core'
import { safeStringify } from './string-utils'
import { TaskManager } from './task-manager'
import { randomString } from './crypto'
import * as CFNResponse from './cfn-response'
import {
  Env,
  Logger,
  Bot,
  Middleware,
  IRequestContext,
  ILambdaExecutionContext,
  ILambdaHttpExecutionContext,
  ILambdaCloudWatchLogsExecutionContext,
  ISNSExecutionContext,
  LambdaHandler,
  ILambdaOpts,
  AwsApis,
} from './types'

import Errors from './errors'
import {
  defineGetter,
  parseArn,
  isPromise,
  syncClock,
  createLambdaContext,
  isXrayOn,
  getCurrentCallStack,
  runWithTimeout,
} from './utils'

import {
  ILambdaAWSExecutionContext
} from './types'

import { warmup } from './middleware/warmup'

const NOT_FOUND = new Error('nothing here')

// 10 mins
const CF_EVENT_TIMEOUT = 10 * 60000
const { commit } = require('./version')

type Contextualized<T> = (ctx: T, next: Function) => any|void

export enum EventSource {
  HTTP='http',
  LAMBDA='lambda',
  DYNAMODB='dynamodb',
  IOT='iot',
  CLOUDFORMATION='cloudformation',
  SCHEDULE='schedule',
  S3='s3',
  SNS='sns',
  CLI='cli',
  CLOUDWATCH_LOGS='cloudwatchlogs',
}

export type Lambda = BaseLambda<ILambdaExecutionContext>
export type LambdaHttp = BaseLambda<ILambdaHttpExecutionContext>

export const fromHTTP = (opts={}):BaseLambda<ILambdaHttpExecutionContext> => new BaseLambda({ ...opts, source: EventSource.HTTP })
export const fromDynamoDB = (opts={}) => new BaseLambda({ ...opts, source: EventSource.DYNAMODB })
export const fromIot = (opts={}) => new BaseLambda({ ...opts, source: EventSource.IOT })
export const fromSchedule = (opts={}) => new BaseLambda({ ...opts, source: EventSource.SCHEDULE })
export const fromCloudFormation = (opts={}) => new BaseLambda({ ...opts, source: EventSource.CLOUDFORMATION })
export const fromLambda = (opts={}) => new BaseLambda({ ...opts, source: EventSource.LAMBDA })
export const fromS3 = (opts={}) => new BaseLambda({ ...opts, source: EventSource.S3 })
export const fromSNS = (opts={}) => new BaseLambda<ISNSExecutionContext>({ ...opts, source: EventSource.SNS })
export const fromCli = (opts={}) => new BaseLambda({ ...opts, source: EventSource.CLI })
export const fromCloudwatchLogs = (opts={}) => new BaseLambda<ILambdaCloudWatchLogsExecutionContext>({ ...opts, source: EventSource.CLOUDWATCH_LOGS })

export class BaseLambda<Ctx extends ILambdaExecutionContext> extends EventEmitter {
  // initialization
  public source: EventSource
  public opts: ILambdaOpts<Ctx>
  public bot: Bot
  public env: Env
  public koa: Koa
  public tasks: TaskManager

  // runtime
  public reqCtx: IRequestContext
  public execCtx: Ctx
  public logger: Logger

  public isCold: boolean
  public containerId: string
  public accountId: string
  public requestCounter: number
  public xraySegment?: AWS.XRay.Segment
  private breakingContext: string
  private middleware:Middleware<Ctx>[]
  private initPromise: Promise<void>
  private _gotHandler: boolean
  private lastExitStack: string
  private aws: AwsApis
  constructor(opts:ILambdaOpts<Ctx>={}) {
    super()
    const {
      middleware,
      source
    } = opts

    const bot = opts.bot || require('./').createBot()

    this.opts = opts
    this.bot = bot
    this.env = bot.env
    this.aws = bot.aws

    bot.aws.on('new', ({ name, recordable }) => this._recordService(recordable, name))

    this.tasks = bot.tasks
    this.tasks.add({
      name: 'bot:ready',
      promise: bot.promiseReady()
    })

    this.on('run', () => {
      if (!this.isCold && !bot.isReady()) {
        this.logger.error('1. LAMBDA FAILED TO INITIALIZE ON FIRST RUN')
      }
    })

    this.on('done', () => {
      if (!bot.isReady()) {
        this.logger.error('2. LAMBDA FAILED TO INITIALIZE ON FIRST RUN')
      }
    })

    this.source = opts.source
    this.middleware = []
    this.isCold = true
    this.containerId = `${randomName.first()} ${randomName.middle()} ${randomName.last()} ${randomString(6)}`

    if (opts.source == EventSource.HTTP) {
      this._initHttp()
    } else if (opts.source === EventSource.CLOUDFORMATION) {
      this._initCloudFormation()
    } else if (opts.source === EventSource.CLOUDWATCH_LOGS) {
      this._initCloudWatchLogs()
    }

    this.requestCounter = 0
    this.exit = this.exit.bind(this)
    this.reset()
    this._gotHandler = false

    this.use(async (ctx, next) => {
      if (this.env.DISABLED) {
        this.logger.info('I have been disabled :(')
        ctx.body = {}
      } else {
        await next()
      }
    })

    this.use(warmup(this))

    // no point in warming up as these events
    // are once in a lifetime
    if (source !== EventSource.CLOUDFORMATION) {
      this.tasks.add({
        name: 'warmup:cache',
        promiser: () => bot.warmUpCaches()
      })
    }

    this.use(async (ctx, next) => {
      await bot.promiseReady()
      await next()
    })

    this.init()
    if (middleware) this.use(middleware)

    process.nextTick(() => {
      if (!this._gotHandler) {
        console.warn(`did you forget to export "${this.shortName}" lambda's handler?`)
      }
    })
  }

  public use = (middleware:Middleware<Ctx>) => {
    if (this._gotHandler) {
      console.warn('adding middleware after exporting the lambda handler ' +
        'can result in unexpected behavior')
    }

    if (isPromise(middleware)) {
      middleware = promiseMiddleware(middleware)
    }

    if (typeof middleware !== 'function') {
      throw new Error('middleware must be a function!')
    }

    if (this.source === EventSource.HTTP) {
      // @ts-ignore
      this.koa.use(middleware)
    } else {
      this.middleware.push(middleware)
    }

    return this
  }

  get name():string {
    return this.env.AWS_LAMBDA_FUNCTION_NAME
  }

  get shortName():string {
    return this.env.FUNCTION_NAME
  }

  get stage():string {
    return this.env.SERVERLESS_STAGE
  }

  get requestId():string {
    return this.reqCtx.requestId
  }

  get correlationId():string {
    return this.reqCtx.correlationId
  }

  get dateOfBirth():number {
    return dateOfBirth
  }

  get containerAge():number {
    return Date.now() - dateOfBirth
  }

  get executionTime():number {
    return this.reqCtx ? Date.now() - this.reqCtx.start : 0
  }

  get done() {
    return !this.execCtx || this.execCtx.done
  }

  get timeLeft() {
    if (this.execCtx) {
      const { context } = this.execCtx
      if (context && context.getRemainingTimeInMillis) {
        return Math.max(context.getRemainingTimeInMillis(), 0)
      }

      if (this.isTesting) {
        return 5000
      }
    }

    return 0
  }

  get isTesting():boolean {
    return this.env.IS_TESTING
  }

  get isEmulated():boolean {
    return this.env.IS_EMULATED
  }

  get isLocal():boolean {
    return this.env.IS_LOCAL
  }

  get isProd():boolean {
    return this.stage === 'prod'
  }

  // get thenHandler() {
  //   return result => this.exit(null, result)
  // }

  // get notFoundHandler() {
  //   return () => this.exit(NOT_FOUND)
  // }

  // get errorHandler() {
  //   return err => this.exit(err)
  // }

  public getRemainingTimeWithBuffer = (buffer: number) => {
    return Math.max(this.timeLeft - buffer, 0)
  }

  public exit = async (err?, result?) => {
    if (this.done) {
      throw new Error(`exit can only be called once per lambda invocation!
Previous exit stack: ${this.lastExitStack}`)
    }

    this.lastExitStack = getCurrentCallStack()
    this.logger.debug('preparing for exit', {
      requestTime: this.executionTime,
      timeLeft: this.timeLeft
    })

    const ctx = this.execCtx
    ctx.done = true

    // leave a tiny bit of breathing room for after the timeout
    const { shortName } = this
    const start = Date.now()
    try {
      await runWithTimeout(() => this.finishAsyncTasks(), {
        millis: Math.max(this.timeLeft - 200, 0),
        error: () => {
          const time = Date.now() - start
          return new Errors.ExecutionTimeout(`lambda ${shortName} timed out after ${time}ms waiting for async tasks to complete`)
        }
      })
    } catch (err) {
      const tasks = this.tasks.describe()
      if (Errors.matches(err, Errors.ExecutionTimeout)) {
        this.logger.error('async tasks timed out', { tasks })
      } else {
        this.logger.error('async tasks failed', {
          tasks,
          ...Errors.export(err)
        })
      }
    }

    if (!this.bot.isReady()) {
      this.breakingContext = safeStringify({
        execCtx: this.execCtx,
        reqCtx: this.reqCtx,
        tasks: this.tasks.describe(),
        reason: 'bot is not ready',
      })

      this._ensureNotBroken()
    }

    if (err) {
      ctx.error = err
    } else {
      err = ctx.error
    }

    if (err) {
      this.logger.error('lambda execution hit an error', {
        error: err,
        serviceCalls: this._dumpServiceCalls(),
      })

      if (this.source !== EventSource.HTTP) {
        ctx.error = new Error(err.message)
      }
    } else {
      if (result) {
        ctx.body = result
      }

      const serviceCalls = this._dumpServiceCalls()
      if (!_.isEmpty(serviceCalls.services)) {
        this.logger.silly('service calls made', serviceCalls)
      }
    }

    this.emit('done')
    this.isCold = false
    this.logger.silly('exiting')

    // http exits via koa
    if (this.source !== EventSource.HTTP) {
      if (!ctx.callback) {
        throw new Error('lambda already exited')
      }

      ctx.callback(ctx.error, ctx.error ? null : ctx.body)
    }

    this.reset()
  }

  public run = async () => {
    this.emit('run')
    const exec = compose(this.middleware)
    const ctx = this.execCtx
    if (!ctx) throw new Error('missing execution context')

    try {
      await exec(ctx)
    } catch (err) {
      debugger
      this.logger.error('error in execution', err.stack)
      if (!ctx.error) {
        ctx.error = err
      }
    }

    if (!this.done) this.exit()
  }

  private preProcess = async ({
    event,
    context,
    request,
    callback
  }: {
    event,
    context,
    request?,
    callback?
  }) => {
    this.tasks.add({
      name: 'system:syncclock',
      promise: () => this.syncClock(),
    })

    await this.initPromise

    this._recordServiceCalls()
    this._ensureNotBroken()
    if (!this.accountId) {
      const { invokedFunctionArn } = context
      if (invokedFunctionArn) {
        const { accountId } = parseArn(invokedFunctionArn)
        this.accountId = accountId
      }
    }

    context.callbackWaitsForEmptyEventLoop = false
    this.logger = this.bot.logger.sub({
      namespace: `lambda:${this.shortName}`
    })

    if (this.source === EventSource.LAMBDA &&
      event.requestContext &&
      event.payload) {
      // some lambda invocations come wrapped
      // to propagate request context
      this.reqCtx = event.requestContext
      event = event.payload
    }

    if (this.source === EventSource.HTTP) {
      if (typeof event.body === 'string') {
        const enc = event.isBase64Encoded ? 'base64' : 'utf8'
        event.body = new Buffer(event.body, enc)
      }

      const headers = caseless(request.headers)
      if (!this.isEmulated && headers.get('content-encoding') === 'gzip') {
        this.logger.silly('stripping content-encoding header as APIGateway already gunzipped')
        headers.set('content-encoding', 'identity')
        event.headers = request.headers
      }
    }

    this.setExecutionContext({ event, context, callback })
    this.reqCtx = getRequestContext(this)
    this.logger.info('request context', this.reqCtx)
    if (isXrayOn()) {
      this.xraySegment = AWSXray.getSegment()
      // AWSXray.captureFunc('annotations', subsegment => {
      //   subsegment.addAnnotation("isCold", this.isCold)
      // })
    }

    this.env.setLambda(this)
  }

  private finishAsyncTasks = async () => {
    const results = await this.tasks.awaitAllSettled()
    const failed = results.filter(r => r.isRejected)
    if (failed.length) {
      this.logger.warn(`${failed.length} async tasks failed`, {
        failed: failed.map(({ reason, task }) => ({ reason, task }))
      })
    }
  }

  private reset () {
    this.reqCtx = null
    this.execCtx = null
    this.lastExitStack = null
    this.logger = this.bot.logger.sub({
      namespace: this.env.FUNCTION_NAME
    })
  }

  private _initHttp = () => {
    const Koa = require('koa')
    this.koa = new Koa()
    this.use(async (ctx, next) => {
      // pretty hacky!
      const { execCtx } = this
      this.execCtx = ctx
      const overwritten = _.pick(execCtx, Object.keys(ctx))
      if (Object.keys(overwritten).length) {
        this.logger.warn('overwriting these properties on execution context', Object.keys(overwritten))
      }

      Object.assign(this.execCtx, execCtx)

      this.emit('run')
      if (!this.done) {
        try {
          await next()
        } catch (err) {
          ctx.error = err
          if (!ctx.status || ctx.status <= 300) {
            ctx.status = 500
          }

          ctx.body = this._exportError(ctx.error)
        }
      }

      if (!ctx.body) {
        // i don't think API Gateway likes non-json responses
        // it lets them through but Content-Type still ends up as application/json
        // and clients fail on trying to parse an empty string as json
        ctx.body = {}
      }

      await this.exit()
    })

    if (!this.isLocal) {
      this.use(require('koa-compress')())
    }

    defineGetter(this, 'body', () => {
      const { body={} } = this.execCtx.event
      return typeof body === 'string' ? JSON.parse(body) : body
    })

    defineGetter(this, 'queryParams', () => {
      return this.execCtx.event.queryStringParameters || {}
    })

    defineGetter(this, 'params', () => {
      return this.execCtx.event.pathParameters || {}
    })
  }

  private _initCloudFormation = () => {
    this.use(async (ctx, next) => {
      const { event, context } = ctx
      const { RequestType, ResourceProperties, ResponseURL } = event
      this.logger.debug(`received stack event`, event)

      let type = RequestType.toLowerCase()
      type = type === 'create' ? 'init' : type
      ctx.event = {
        type,
        payload: ResourceProperties
      }

      let err
      try {
        // await bot.hooks.fire(type, ctx.event)
        await runWithTimeout(next, {
          millis: CF_EVENT_TIMEOUT,
          error: () => new Errors.ExecutionTimeout(`lambda ${this.shortName} timed out after ${CF_EVENT_TIMEOUT}ms`),
        })
      } catch (e) {
        err = e
      }

      if (ResponseURL) {
        const respond = err ? CFNResponse.sendError : CFNResponse.sendSuccess
        const data = err ? _.pick(err, ['message', 'stack']) : {}
        await respond(event, context, data)
        return
      }

      // test mode
      if (err) throw err
    })
  }

  private _initCloudWatchLogs = () => {
    this.use(async (ctx, next) => {
      ctx.gzippedEvent = new Buffer(ctx.event.awslogs.data, 'base64')
      const str = zlib.gunzipSync(ctx.gzippedEvent).toString('utf8')
      ctx.event = JSON.parse(str)

      // once decoded, the CloudWatch invocation event looks like this:
      // {
      //     "messageType": "DATA_MESSAGE",
      //     "owner": "374852340823",
      //     "logGroup": "/aws/lambda/big-mouth-dev-get-index",
      //     "logStream": "2018/03/20/[$LATEST]ef2392ba281140eab63195d867c72f53",
      //     "subscriptionFilters": [
      //         "LambdaStream_logging-demo-dev-ship-logs"
      //     ],
      //     "logEvents": [
      //         {
      //             "id": "33930704242294971955536170665249597930924355657009987584",
      //             "timestamp": 1521505399942,
      //             "message": "START RequestId: e45ea8a8-2bd4-11e8-b067-ef0ab9604ab5 Version: $LATEST\n"
      //         },
      //         {
      //             "id": "33930707631718332444609990261529037068331985646882193408",
      //             "timestamp": 1521505551929,
      //             "message": "2018-03-20T00:25:51.929Z\t3ee1bd8c-2bd5-11e8-a207-1da46aa487c9\t{ \"message\": \"found restaurants\" }\n",
      //             "extractedFields": {
      //                 "event": "{ \"message\": \"found restaurants\" }\n",
      //                 "request_id": "3ee1bd8c-2bd5-11e8-a207-1da46aa487c9",
      //                 "timestamp": "2018-03-20T00:25:51.929Z"
      //             }
      //         }
      //     ]
      // }

      await next()
    })
  }

  public invoke = async (event) => {
    return new Promise((resolve, reject) => {
      const callback = (err, result) => {
        if (err) return reject(err)
        resolve(resolve)
      }

      const context = createLambdaContext({
        name: this.shortName,
      }, callback)

      this.handler(event, context, callback)
    })
  }

  // important that this is lazy
  // because otherwise handlers attached after initialization
  // will not get composed properly
  public get handler():LambdaHandler {
    this._gotHandler = true
    if (this.source === EventSource.HTTP) {
      const { createHandler } = require('./http-request-handler')
      return createHandler({
        lambda: this,
        preProcess: (request, event, context) => this.preProcess({ request, event, context }),
        postProcess: (response, event, context) => {}
      })
    }

    return async (event, context, callback) => {
      await this.preProcess({ event, context, callback })
      await this.run()
    }
  }

  private setExecutionContext = ({ event, context, callback, ...opts }) => {
    const awsExecCtx:ILambdaAWSExecutionContext = {
      ...context,
      done: this.exit,
      succeed: result => this.exit(null, result),
      fail: this.exit
    }

    // don't understand the error...
    // @ts-ignore
    this.execCtx = {
      ...opts,
      done: false,
      event,
      context: awsExecCtx,
      callback: wrapCallback(this, callback || context.done.bind(context))
    }

    return this.execCtx
  }

  private syncClock = () => {
    syncClock(this.bot)
  }

  private init = () => {
    this.initPromise = syncClock(this.bot)
  }

  private _exportError = (err) => {
    if (this.isLocal) {
      return Errors.export(err)
    }

    return {
      message: 'execution failed'
    }
  }

  private _ensureNotBroken = () => {
    if (!this.isLocal && this.breakingContext) {
      const msg = 'I am broken!: ' + this.breakingContext
      this.logger.error(msg)
      throw new Error(msg)
    }
  }

  private _recordServiceCalls = () => {
    forEachInstantiatedRecordableService(this.aws, this._recordService)
  }

  private _recordService = (service, name) => {
    if (!service.$startRecording) return

    service.$stopRecording()
    service.$startRecording()
  }

  private _dumpServiceCalls = () => {
    const summary = {
      start: Infinity,
      duration: 0,
      services: {},
    }

    forEachInstantiatedRecordableService(this.aws, (service, name) => {
      const dump = service.$stopRecording()
      if (!dump.calls.length) return

      summary.services[name] = dump.calls
      summary.start = Math.min(summary.start, dump.start)
      summary.duration = Math.max(summary.duration, dump.duration)
    })

    return summary
  }
}

const forEachInstantiatedRecordableService = (aws: AwsApis, fn) => {
  const instantiated = aws.getInstantiated()
  for (const name of instantiated) {
    const service = aws[name]
    if (service && service.$stopRecording) {
      fn(service, name)
    }
  }
}

export const createLambda = <T extends ILambdaExecutionContext>(opts: ILambdaOpts<T>) => new BaseLambda(opts)

const wrapCallback = (lambda, callback) => (err, result) => {
  if (lambda.done) {
    callback(err, result)
  } else {
    lambda.exit(err, result)
  }
}

const getRequestContext = <T extends ILambdaExecutionContext>(lambda:BaseLambda<T>):IRequestContext => {
  const { execCtx } = lambda
  const { event, context } = execCtx
  const correlationId = lambda.source === EventSource.HTTP
    ? event.requestContext.requestId
    : context.awsRequestId

  const ctx:IRequestContext = {
    ...(lambda.reqCtx || {}),
    seq: lambda.requestCounter++,
    requestId: context.awsRequestId,
    correlationId,
    containerId: lambda.containerId,
    commit,
    start: Date.now()
  }

  defineGetter(ctx, 'botReady', () => lambda.bot.isReady())
  if (lambda.env._X_AMZN_TRACE_ID) {
    ctx['trace-id'] = lambda.env._X_AMZN_TRACE_ID
  }

  if (lambda.isEmulated) {
    ctx['function'] = lambda.env.FUNCTION_NAME
  }

  if (lambda.isCold) {
    ctx.cold = true
  }

  return ctx
}

const promiseMiddleware = promise => {
  let middleware
  return async (ctx, next) => {
    if (!middleware) middleware = await promise

    await middleware(ctx, next)
  }
}
