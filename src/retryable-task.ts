// @ts-ignore
import Promise = require('bluebird')
import _ = require('lodash')
import { Logger } from './types'
import Errors = require('./errors')

type ShouldRetry = (err) => boolean

export interface IRetryableTaskOpts {
  initialDelay?: number
  maxAttempts?: number
  maxTime?: number
  maxDelay?: number
  factor?: number
  logger?: Logger
  shouldTryAgain: ShouldRetry
}

export default class RetryableTask {
  private shouldTryAgain: ShouldRetry
  private initialDelay: number
  private maxAttempts: number
  private maxTime: number
  private maxDelay: number
  private factor: number
  private logger?: Logger
  constructor({
    shouldTryAgain,
    initialDelay=1000,
    maxAttempts=10,
    maxTime=60000,
    maxDelay,
    factor=2,
    logger
  }: IRetryableTaskOpts) {
    this.shouldTryAgain = shouldTryAgain
    this.initialDelay = initialDelay
    this.maxAttempts = maxAttempts
    this.maxTime = maxTime
    this.maxDelay = typeof maxDelay === 'number' ? maxDelay : maxTime / 2
    this.factor = factor
    this.logger = logger
  }

  public run = async (fn:() => Promise) => {
    const start = Date.now()
    let millisToWait = this.initialDelay
    let { factor, maxDelay, maxTime, maxAttempts } = this
    let attempts = 0
    while (Date.now() - start < maxTime && attempts++ < maxAttempts) {
      try {
        return await fn()
      } catch (err) {
        if (!this.shouldTryAgain(err)) {
          throw err
        }

        if (this.logger) {
          this.logger.debug(`backing off ${millisToWait}`, _.pick(err, ['code', 'message']))
        }

        await Promise.delay(millisToWait)
        millisToWait = Math.min(
          maxDelay,
          millisToWait * factor,
          (start + maxTime) - Date.now()
        )
      }
    }

    throw new Errors.Timeout(`after ${(Date.now() - start)}ms`)
  }
}

export { RetryableTask }
