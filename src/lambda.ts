// adapted from: https://github.com/Movement-2016/bellman
const dateOfBirth = Date.now()

require('source-map-support').install()

// require('time-require')
import './globals'

import { EventEmitter } from 'events'
import fs from 'fs'
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
  LambdaHandler,
  ILambdaOpts
} from './types'

import Errors from './errors'
import {
  defineGetter,
  timeoutIn,
  parseArn,
  isPromise,
  syncClock,
  createLambdaContext,
  isXrayOn
} from './utils'

import {
  ILambdaAWSExecutionContext
} from './types'

import { warmup } from './middleware/warmup'

const NOT_FOUND = new Error('nothing here')

// 10 mins
const CF_EVENT_TIMEOUT = 10 * 60000

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
  CLI='cli'
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
export const fromSNS = (opts={}) => new BaseLambda({ ...opts, source: EventSource.SNS })
export const fromCli = (opts={}) => new BaseLambda({ ...opts, source: EventSource.CLI })

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
    }

    this.requestCounter = 0
    this.exit = this.exit.bind(this)
    this.reset()
    this._gotHandler = false

    this.use(async (ctx, next) => {
      this.logger.debug('received event', { containerAge: this.containerAge })
      if (this.env.DISABLED) {
        this.logger.debug('I have been disabled :(')
        ctx.body = {}
      } else {
        await next()
      }
    })

    if (opts.devModeOnly) {
      this.use(async (ctx, next) => {
        if (!this.isTesting) throw new Error('forbidden')

        await next()
      })
    }

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
    return this.env.TESTING
  }

  get isUsingServerlessOffline():boolean {
    return this.env.IS_OFFLINE
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

  public exit = async (err?, result?) => {
    if (this.done) {
      throw new Error(`exit can only be called once per lambda invocation!
Previous exit stack: ${this.lastExitStack}`)
    }

    this.lastExitStack = new Error('exit').stack
    this.logger.debug('preparing for exit', {
      requestTime: this.executionTime,
      timeLeft: this.timeLeft
    })

    const ctx = this.execCtx
    ctx.done = true

    // leave a tiny bit of breathing room for after the timeout
    const { shortName } = this
    const start = Date.now()
    const timeout = timeoutIn({
      millis: Math.max(this.timeLeft - 200, 0),
      get error() {
        const time = Date.now() - start
        return new Errors.ExecutionTimeout(`lambda ${shortName} timed out after ${time}ms waiting for async tasks to complete`)
      }
    })

    try {
      await Promise.race([
        // always resolves, but may stall
        this.finishAsyncTasks(),
        timeout
      ])
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

    timeout.cancel()

    if (!this.bot.isReady()) {
      this.breakingContext = safeStringify({
        execCtx: this.execCtx,
        reqCtx: this.reqCtx,
        tasks: this.tasks.describe()
      })

      this._ensureNotBroken()
    }

    if (err) {
      ctx.error = err
    } else {
      err = ctx.error
    }

    if (err) {
      this.logger.error('lambda execution hit an error', err)
      if (this.source !== EventSource.HTTP) {
        ctx.error = new Error(err.message)
      }
    } else if (result) {
      ctx.body = result
    }

    this.emit('done')
    this.isCold = false
    this.logger.debug('exiting')

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
    await this.initPromise
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
      namespace: `lambda:${this.shortName}`,
      context: this.reqCtx
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
      if (!this.isUsingServerlessOffline && headers.get('content-encoding') === 'gzip') {
        this.logger.info('stripping content-encoding header as APIGateway already gunzipped')
        headers.set('content-encoding', 'identity')
        event.headers = request.headers
      }
    }

    this.setExecutionContext({ event, context, callback })
    this.reqCtx = getRequestContext(this)
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

    if (!this.isTesting) {
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
      this.logger.debug(`received stack event: ${RequestType}`)

      let type = RequestType.toLowerCase()
      type = type === 'create' ? 'init' : type
      ctx.event = {
        type,
        payload: ResourceProperties
      }

      let err
      try {
        // await bot.hooks.fire(type, ctx.event)
        await Promise.race([
          next(),
          timeoutIn({
            millis: CF_EVENT_TIMEOUT,
            get error() {
              return new Errors.ExecutionTimeout(`lambda ${this.shortName} timed out after ${CF_EVENT_TIMEOUT}ms`)
            }
          })
        ])
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

  private init = () => {
    this.initPromise = syncClock(this.bot)
  }

  private _exportError = (err) => {
    if (this.isTesting) {
      return Errors.export(err)
    }

    return {
      message: 'execution failed'
    }
  }

  private _ensureNotBroken = () => {
    if (!this.isTesting && this.breakingContext) {
      throw new Error('I am broken!: ' + this.breakingContext)
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
    start: Date.now()
  }

  defineGetter(ctx, 'botReady', () => lambda.bot.isReady())
  if (lambda.env._X_AMZN_TRACE_ID) {
    ctx['trace-id'] = lambda.env._X_AMZN_TRACE_ID
  }

  if (lambda.isUsingServerlessOffline) {
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
