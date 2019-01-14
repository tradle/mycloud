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
import { Env, createEnv } from './env'
import { createLogger } from './logger'
import { createAWSWrapper } from './aws'
import {
  Logger,
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
  plainify,
} from './utils'

import {
  ILambdaAWSExecutionContext
} from './types'

import { warmup } from './middleware/warmup'
import { requestInterceptor, RequestInfo } from './request-interceptor'

const NOT_FOUND = new Error('nothing here')

// 10 mins
const CF_EVENT_TIMEOUT = 10 * 60000
const { commit } = require('./version')

type Contextualized<T> = (ctx: T, next: Function) => any|void

interface PendingCallsSummary {
  start?: number
  duration?: number
  httpRequests?: RequestInfo[]
  services: {
    [name: string]: any[]
  }
}

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
export type BaseLambdaOpts = ILambdaOpts<ILambdaExecutionContext>

// const normalizeOpts = opts => {
//   if (!opts.env) opts.env = new Env(process.env)
// }

type PartialOpts = Partial<BaseLambdaOpts>

const normalizeOpts = (partial: PartialOpts):BaseLambdaOpts => {
  const env = partial.env || (partial.bot && partial.bot.env) || createEnv()
  const logger = partial.logger || env.logger
  const aws = partial.aws || (partial.bot && partial.bot.aws) || createAWSWrapper({ env, logger })

  return {
    ...partial,
    env,
    logger,
    aws,
  }
}

const createFromPartial = (opts:PartialOpts) => new BaseLambda(normalizeOpts(opts))

export const fromHTTP = (opts:PartialOpts):LambdaHttp => createFromPartial({ ...opts, source: EventSource.HTTP }) as LambdaHttp
export const fromDynamoDB = (opts:PartialOpts) => createFromPartial({ ...opts, source: EventSource.DYNAMODB })
export const fromIot = (opts:PartialOpts) => createFromPartial({ ...opts, source: EventSource.IOT })
export const fromSchedule = (opts:PartialOpts) => createFromPartial({ ...opts, source: EventSource.SCHEDULE })
export const fromCloudFormation = (opts:PartialOpts) => createFromPartial({ ...opts, source: EventSource.CLOUDFORMATION })
export const fromLambda = (opts:PartialOpts) => createFromPartial({ ...opts, source: EventSource.LAMBDA })
export const fromS3 = (opts:PartialOpts) => createFromPartial({ ...opts, source: EventSource.S3 })
export const fromSNS = (opts:PartialOpts) => new BaseLambda<ISNSExecutionContext>(normalizeOpts({ ...opts, source: EventSource.SNS }))
export const fromCli = (opts:PartialOpts) => createFromPartial({ ...opts, source: EventSource.CLI })
export const fromCloudwatchLogs = (opts:PartialOpts) => new BaseLambda<ILambdaCloudWatchLogsExecutionContext>(normalizeOpts({ ...opts, source: EventSource.CLOUDWATCH_LOGS }))

export class BaseLambda<Ctx extends ILambdaExecutionContext> extends EventEmitter {
  // initialization
  public source: EventSource
  public opts: ILambdaOpts<Ctx>
  public env: Env
  public koa: Koa
  public tasks: TaskManager
  public aws: AwsApis

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
  private _gotHandler: boolean
  private lastExitStack: string
  constructor(opts:ILambdaOpts<Ctx>) {
    super()
    const {
      env,
      aws,
      logger,
      middleware,
      source,
    } = opts

    this.opts = opts
    this.env = env
    this.aws = aws
    this.logger = logger

    aws.on('new', ({ name, recordable }) => this._recordService(recordable, name))

    this.tasks = new TaskManager({ logger: this.logger.sub('tasks') })
    this.source = opts.source
    this.middleware = []
    this.isCold = true
    this.containerId = `${randomName.first()} ${randomName.middle()} ${randomName.last()} ${randomString(6)}`

    if (opts.source === EventSource.HTTP) {
      this._initHttp()
    } else if (opts.source === EventSource.CLOUDFORMATION) {
      this._initCloudFormation()
    } else if (opts.source === EventSource.CLOUDWATCH_LOGS) {
      this._initCloudWatchLogs()
    }

    this.requestCounter = 0
    this.finishRun = this.finishRun.bind(this)
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
    return this.env.STACK_STAGE
  }

  get requestId():string {
    return this.reqCtx && this.reqCtx.requestId
  }

  get correlationId():string {
    return this.reqCtx && this.reqCtx.correlationId
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

  public getRemainingTimeWithBuffer = (buffer: number) => {
    return Math.max(this.timeLeft - buffer, 0)
  }

  public finishRun = async (err?, result?) => {
    if (this.done) {
      throw new Error(`finishRun can only be called once per lambda invocation!
Previous exit stack: ${this.lastExitStack}`)
    }

    this.lastExitStack = getCurrentCallStack()
    this.logger.debug('preparing for exit', {
      requestTime: this.executionTime,
      timeLeft: this.timeLeft
    })

    const ctx = this.execCtx
    ctx.done = true

    const { shortName, requestId } = this
    const start = Date.now()
    try {
      await runWithTimeout(() => this.finishAsyncTasks(), {
        // leave a tiny bit of breathing room for after the timeout
        millis: Math.max(this.timeLeft - 1000, 0),
        error: () => {
          const time = Date.now() - start
          return new Errors.ExecutionTimeout(`lambda ${shortName} timed out after ${time}ms waiting for async tasks to complete`)
        }
      })
    } catch (err) {
      if (this.requestId !== requestId) {
        this.logger.error(`seems we're already on a different request`, {
          error: err,
          originalRequestId: requestId,
          requestId: this.requestId,
        })

        return
      }

      const tasks = this.tasks.describe()
      if (Errors.matches(err, Errors.ExecutionTimeout)) {
        this.logger.error('async tasks timed out', { tasks, time: Date.now() - start })
      } else {
        this.logger.error('async tasks failed', {
          tasks,
          ...Errors.export(err)
        })
      }
    }

    if (err) {
      ctx.error = err
    } else {
      err = ctx.error
    }

    const pendingServiceCalls = this._dumpPendingServiceCalls()
    if (!_.isEmpty(pendingServiceCalls.services)) {
      this.logger.debug('pending service calls', pendingServiceCalls)
    }

    requestInterceptor.freeze(this.requestId)

    const pendingHttpRequests = this._dumpPendingHTTPRequests()
    if (pendingHttpRequests.length) {
      this.logger.debug('pending http requests', pendingHttpRequests)
      if (this.env.ABORT_REQUESTS_ON_FREEZE) {
        this.logger.warn(`aborting ${pendingHttpRequests.length} pending http requests`)
        requestInterceptor.abortPending()
      }
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

      if (this.logger.isRidiculous()) {
        const serviceCalls = this._dumpServiceCalls()
        if (!_.isEmpty(serviceCalls.services)) {
          this.logger.ridiculous('service calls made', serviceCalls)
        }
      }
    }

    this.emit('done')
    this.isCold = false
    this.logger.silly('exiting')
    if (ctx.error) {
      throw ctx.error
    }

    this.reset()
    return ctx.body
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

    return await this.finishRun()
  }

  private preProcess = async ({
    event,
    context,
    request,
  }: {
    event,
    context,
    request?,
  }) => {
    this._recordServiceCalls()
    if (!this.accountId) {
      const { invokedFunctionArn } = context
      if (invokedFunctionArn) {
        const { accountId } = parseArn(invokedFunctionArn)
        this.accountId = accountId
      }
    }

    context.callbackWaitsForEmptyEventLoop = false

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

    this.setExecutionContext({ event, context })
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
          this.logger.error('request hit an error', {
            error: Errors.export(err)
          })

          // lambda should not fail!
          // it should return a failure status code but succeed
          if (typeof err.status === 'number') {
            ctx.status = err.status
            ctx.body = { message: err.message }
          } else if (!ctx.body && ctx.status === 404) { // koa defaults to 404
            this.logger.debug('defaulting to status code 500')
            ctx.status = 500
            ctx.body = this._exportError(err)
          } else {
            this.logger.debug('status and body already set on failed req', {
              status: ctx.status,
              body: ctx.body,
              error: err.stack
            })
          }
        }
      }

      if (!ctx.body) {
        // i don't think API Gateway likes non-json responses
        // it lets them through but Content-Type still ends up as application/json
        // and clients fail on trying to parse an empty string as json
        ctx.body = {}
      }

      await this.finishRun()
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
    const context = createLambdaContext({
      name: this.shortName,
    })

    return await this.handler(event, context)
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

    return (event, context) => {
      const promise = this.preProcess({ event, context })
        .then(() => this.run())

      if (context && context.done) {
        // until issue is resolved, avoid returning a promise:
        // https://github.com/aws/aws-xray-sdk-node/issues/27#issuecomment-380092859
        promise.then(result => context.done(null, result), context.done)
      } else {
        return promise
      }
    }
  }

  private setExecutionContext = ({ event, context, ...opts }) => {
    const awsExecCtx:ILambdaAWSExecutionContext = {
      ...context,
    }

    // don't understand the error...
    // @ts-ignore
    this.execCtx = {
      ...opts,
      done: false,
      event,
      context: awsExecCtx,
    }

    return this.execCtx
  }

  private _exportError = (err) => {
    if (this.isLocal) {
      return Errors.export(err)
    }

    return {
      message: 'execution failed'
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

  private _dumpPendingServiceCalls = ():PendingCallsSummary => {
    try {
      // should never fail cause of this
      return this.__dumpPendingServiceCalls()
    } catch (err) {
      this.logger.error('failed to dump pending service calls', {
        error: err.stack
      })

      return { services: {} }
    }
  }

  private _dumpPendingHTTPRequests = ():RequestInfo[] => {
    try {
      return requestInterceptor.getPending()
    } catch (err) {
      this.logger.error('failed to dump pending http requests', {
        error: err.stack
      })

      return []
    }
  }

  private _dumpServiceCalls = ():PendingCallsSummary => {
    try {
      // should never fail cause of this
      return this.__dumpServiceCalls()
    } catch (err) {
      this.logger.error('failed to dump service calls', {
        error: err.stack
      })

      return { services: {} }
    }
  }

  private __dumpPendingServiceCalls = (): PendingCallsSummary => {
    const summary: PendingCallsSummary = {
      start: Infinity,
      duration: 0,
      services: {},
      httpRequests: requestInterceptor.getPending(),
    }

    forEachInstantiatedRecordableService(this.aws, (service, name) => {
      if (name.toLowerCase() === 'iotdata') {
        // TODO: figure out why this fails
        // iotdata requires "endpoint" for initialization, as is initialized lazily, but...
        return
      }

      const dump = service.$getPending()
      if (!dump.calls.length) return

      summary.services[name] = safeStringify(plainify(dump.calls))
        // limit length
        .slice(0, 1000)

      summary.start = Math.min(summary.start, dump.start)
      summary.duration = Math.max(summary.duration, Date.now() - dump.start)
    })

    return summary
  }

  private __dumpServiceCalls = ():PendingCallsSummary => {
    const summary:PendingCallsSummary = {
      start: Infinity,
      duration: 0,
      services: {},
    }

    forEachInstantiatedRecordableService(this.aws, (service, name) => {
      if (name.toLowerCase() === 'iotdata') {
        // TODO: figure out why this fails
        // iotdata requires "endpoint" for initialization, as is initialized lazily, but...
        return
      }

      const dump = service.$stopRecording()
      if (!dump.calls.length) return

      summary.services[name] = safeStringify(plainify(dump.calls))
        // limit length
        .slice(0, 1000)

      summary.start = Math.min(summary.start, dump.start)
      summary.duration = Math.max(summary.duration, dump.duration)
    })

    return summary
  }

  private _suicide = (reason: string) => {
    this.logger.error('I am broken! Suiciding', {
      execCtx: this.execCtx,
      reqCtx: this.reqCtx,
      tasks: this.tasks.describe(),
      reason,
    })

    process.exit(1)
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
