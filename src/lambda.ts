// adapted from: https://github.com/Movement-2016/bellman
const dateOfBirth = Date.now()

require('source-map-support').install()

// require('time-require')
import './globals'

import { EventEmitter } from 'events'
import fs = require('fs')
import {
  pick,
  cloneDeep
} from 'lodash'

// @ts-ignore
import Promise = require('bluebird')
import compose = require('koa-compose')
import caseless = require('caseless')
import randomName = require('random-name')
import { TaskManager } from './task-manager'
import { randomString } from './crypto'
import Env from './env'
import Tradle from './tradle'
import Logger from './logger'
import Errors = require('./errors')
import {
  defineGetter,
  timeoutIn,
  parseArn,
  isPromise
} from './utils'

import {
  ILambdaAWSExecutionContext
} from './types'

import { warmup } from './middleware/warmup'

const NOT_FOUND = new Error('nothing here')

export enum EventSource {
  HTTP='http',
  LAMBDA='lambda',
  DYNAMODB='dynamodb',
  IOT='iot',
  CLOUDFORMATION='cloudformation',
  SCHEDULE='schedule',
  S3='s3'
}

export interface IRequestContext {
  requestId: string
  correlationId: string
  containerId: string
  seq: number
  virgin?: boolean
  start: number
}

export interface ILambdaExecutionContext {
  // requestNumber: number
  event: any
  context: ILambdaAWSExecutionContext
  callback?: Function
  error?: Error
  body?: any
  done: boolean
}

export type LambdaHandler = (event:any, context:ILambdaAWSExecutionContext, callback?:Function)
  => any|void

export interface ILambdaOpts {
  source?: EventSource
  tradle?: Tradle
  [x:string]: any
}

export const fromHTTP = (opts={}) => new Lambda({ ...opts, source: EventSource.HTTP })
export const fromDynamoDB = (opts={}) => new Lambda({ ...opts, source: EventSource.DYNAMODB })
export const fromIot = (opts={}) => new Lambda({ ...opts, source: EventSource.IOT })
export const fromSchedule = (opts={}) => new Lambda({ ...opts, source: EventSource.SCHEDULE })
export const fromCloudFormation = (opts={}) => new Lambda({ ...opts, source: EventSource.CLOUDFORMATION })
export const fromLambda = (opts={}) => new Lambda({ ...opts, source: EventSource.LAMBDA })
export const fromS3 = (opts={}) => new Lambda({ ...opts, source: EventSource.S3 })

export class Lambda extends EventEmitter {
  // initialization
  public source: EventSource
  public opts: any
  public tradle: Tradle
  public env: Env
  public koa?: any
  public tasks: TaskManager

  // runtime
  public reqCtx: IRequestContext
  public execCtx: ILambdaExecutionContext
  public logger: Logger

  public isVirgin: boolean
  public containerId: string
  public accountId: string
  private breakingContext: any
  private middleware:Function[]
  private requestCounter: number
  private _gotHandler: boolean
  constructor(opts:ILambdaOpts={}) {
    super()
    const {
      tradle=require('./').tradle,
      source
    } = opts

    this.opts = opts
    this.tradle = tradle
    this.env = tradle.env
    this.tasks = tradle.tasks
    this.source = opts.source
    this.middleware = []
    this.isVirgin = true
    this.containerId = `${randomName.first()} ${randomName.middle()} ${randomName.last()} ${randomString(6)}`

    if (opts.source == EventSource.HTTP) {
      this._initHttp()
    }

    this.requestCounter = 0
    this.exit = this.exit.bind(this)
    this.reset()
    this._gotHandler = false
    this.use(warmup(this))
    this.tasks.add({
      name: 'warmup:cache',
      promiser: () => tradle.warmUpCaches()
    })

    process.nextTick(() => {
      if (!this._gotHandler) {
        console.warn(`did you forget to export "${this.shortName}" lambda's handler?`)
      }
    })
  }

  public use = (fn:Function|Promise<Function>):Lambda => {
    if (this._gotHandler) {
      console.warn('adding middleware after exporting the lambda handler ' +
        'can result in unexpected behavior')
    }

    if (isPromise(fn)) {
      fn = promiseMiddleware(fn)
    }

    if (typeof fn !== 'function') {
      throw new Error('middleware must be a function!')
    }

    if (this.source === EventSource.HTTP) {
      this.koa.use(fn)
    } else {
      this.middleware.push(fn)
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
      if (this.isTesting) {
        return 5000
      }

      const { context } = this.execCtx
      if (context && context.getRemainingTimeInMillis) {
        return Math.max(context.getRemainingTimeInMillis(), 0)
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
      throw new Error('exit can only be called once per lambda invocation!')
    }

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

    if (this.bot && !this.bot.isReady()) {
      this.breakingContext = {
        execCtx: cloneDeep(this.execCtx),
        reqCtx: cloneDeep(this.reqCtx),
        tasks: this.tasks.describe()
      }

      this._ensureNotBroken()
    }

    if (err) {
      ctx.error = err
    } else {
      err = ctx.error
    }

    if (err) {
      if (Errors.isDeveloperError(err)) {
        this.logger.warn('likely developer error', Errors.export(err))
      }

      ctx.body = this._exportError(err)
      this.logger.debug('lambda execution failed', { stack: err.stack })
    } else if (result) {
      ctx.body = result
    }

    this.emit('done')
    this.isVirgin = false
    this.logger.debug('exiting')

    // http exits via koa
    if (this.source !== EventSource.HTTP) {
      if (!ctx.callback) {
        throw new Error('lambda already exited')
      }

      ctx.callback(ctx.error, ctx.body)
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
      if (ctx.error) {
        this.logger.error('error in execution', err.stack)
      } else {
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
    request,
    callback?
  }) => {
    this._ensureNotBroken()
    if (!this.accountId) {
      const { invokedFunctionArn } = context
      if (invokedFunctionArn) {
        const { accountId } = parseArn(invokedFunctionArn)
        this.accountId = accountId
      }
    }

    context.callbackWaitsForEmptyEventLoop = false
    this.logger = this.tradle.logger.sub({
      namespace: `λ:${this.shortName}`,
      context: this.reqCtx,
      writer: console
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
    this.env.setLambda(this)
  }

  private finishAsyncTasks = async () => {
    const results = await this.tasks.awaitAllSettled()
    const failed = results.filter(r => r.reason)
    if (failed.length) {
      this.logger.warn(`${failed.length} async tasks failed`, {
        failed: failed.map(({ reason, task }) => ({ reason, task }))
      })
    }
  }

  private reset () {
    this.reqCtx = null
    this.execCtx = null
    this.logger = this.tradle.logger.sub({
      namespace: this.env.FUNCTION_NAME,
      writer: console
    })
  }

  private _initHttp = () => {
    const Koa = require('koa')
    this.koa = new Koa()
    this.use(async (ctx, next) => {
      // pretty hacky!
      const { execCtx } = this
      this.execCtx = ctx
      const overwritten = pick(execCtx, Object.keys(ctx))
      if (Object.keys(overwritten).length) {
        this.logger.warn('overwriting these properties on execution context', overwritten)
      }

      Object.assign(this.execCtx, execCtx)

      this.emit('run')
      if (!this.done) {
        try {
          await next()
        } catch (err) {
          ctx.error = err
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
    this.execCtx = {
      ...opts,
      done: false,
      event,
      context: {
        ...context,
        done: this.exit,
        succeed: result => this.exit(null, result),
        fail: this.exit
      },
      callback: wrapCallback(this, callback || context.done.bind(context))
    }

    return this.execCtx
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
    if (this.breakingContext) {
      throw new Error('I am broken!: ' + JSON.stringify(this.breakingContext, null, 2))
    }
  }
}

const wrapCallback = (lambda, callback) => (err, result) => {
  if (lambda.done) {
    callback(err, result)
  } else {
    lambda.exit(err, result)
  }
}

const getRequestContext = (lambda:Lambda):IRequestContext => {
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

  if (lambda.bot) {
    defineGetter(ctx, 'botReady', () => lambda.bot.isReady())
  }

  if (lambda.env._X_AMZN_TRACE_ID) {
    ctx['trace-id'] = lambda.env._X_AMZN_TRACE_ID
  }

  if (lambda.isUsingServerlessOffline) {
    ctx['function'] = lambda.env.FUNCTION_NAME
  }

  if (lambda.isVirgin) {
    ctx.virgin = true
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
