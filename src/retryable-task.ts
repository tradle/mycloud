// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import { Logger } from './types'
import Errors from './errors'
import { runWithTimeout } from './utils'

type ShouldRetry = (err) => boolean

export interface IRetryableTaskOpts {
  initialDelay?: number
  maxAttempts?: number
  timeout?: number
  attemptTimeout?: number
  maxDelay?: number
  factor?: number
  logger?: Logger
  shouldTryAgain: ShouldRetry
}

export default class RetryableTask {
  private shouldTryAgain: ShouldRetry
  private initialDelay: number
  private attemptTimeout: number
  private maxAttempts: number
  private timeout: number
  private maxDelay: number
  private factor: number
  private logger?: Logger
  constructor({
    shouldTryAgain,
    initialDelay=1000,
    maxAttempts=10,
    timeout=60000,
    maxDelay,
    attemptTimeout=Infinity,
    factor=2,
    logger
  }: IRetryableTaskOpts) {
    this.shouldTryAgain = shouldTryAgain
    this.initialDelay = initialDelay
    this.attemptTimeout = attemptTimeout
    this.maxAttempts = maxAttempts
    this.timeout = timeout
    this.maxDelay = typeof maxDelay === 'number' ? maxDelay : timeout / 2
    this.factor = factor
    this.logger = logger
  }

  public run = async (fn:() => Promise) => {
    const start = Date.now()
    let millisToWait = this.initialDelay
    let { factor, maxDelay, timeout, maxAttempts } = this
    let attempts = 0
    let maxTimeLeft = timeout
    while (maxTimeLeft > 0 && attempts++ < maxAttempts) {
      try {
        return await runWithTimeout(fn, {
          millis: Math.min(this.attemptTimeout, maxTimeLeft)
        })
      } catch (err) {
        if (!this.shouldTryAgain(err)) {
          throw err
        }

        if (this.logger) {
          this.logger.debug(`backing off ${millisToWait}`, _.pick(err, ['code', 'message']))
        }

        await Promise.delay(millisToWait)
        maxTimeLeft = start + timeout - Date.now()
        millisToWait = Math.min(
          maxDelay,
          millisToWait * factor,
          maxTimeLeft
        )
      }
    }

    throw new Errors.Timeout(`after ${(Date.now() - start)}ms`)
  }
}

export { RetryableTask }
