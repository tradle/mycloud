import { EventEmitter } from 'events'
import { post, promiseNoop, timeoutIn, tryUntilTimeRunsOut } from './utils'
import { IDelivery, IDeliverBatchRequest } from "./types"
import { IDebug } from './types'
import Logger from './logger'
import Env from './env'
import Errors = require('./errors')

const FETCH_TIMEOUT = 10000

export default class Delivery extends EventEmitter implements IDelivery {
  private env:Env
  private logger:Logger
  constructor({ env, logger }: {
    env: Env,
    logger: Logger
  }) {
    super()
    this.env = env
    this.logger = logger.sub('delivery-http')
  }

  public ack = promiseNoop
  public reject = (opts: { reason: Error }) => Promise.reject(opts.reason)
  public deliverBatch = async (opts:IDeliverBatchRequest) => {
    const { recipient, friend, messages, timeout } = opts
    const endpoint = `${friend.url}/inbox`
    await tryUntilTimeRunsOut(() => post(endpoint, { messages }), {
      env: this.env,
      attemptTimeout: FETCH_TIMEOUT,
      onError: (err:Error) => {
        this.logger.error('failed to deliver messages', { stack: err.stack })
      }
    })

    this.logger.debug(`delivered ${messages.length} messages to ${recipient}`)
    // let timedOut
    // const timer = setTimeout(() => {
    //   timedOut = true
    // }, timeout)

    // while (!timedOut) {
    //   try {
    //     await Promise.race([
    //       post(endpoint, { messages }),
    //       timeoutIn(FETCH_TIMEOUT)
    //     ])
    //   } catch (err) {
    //     this.logger.error('failed to deliver messages', { stack: err.stack })
    //     Errors.ignore(err, Errors.Timeout)
    //   }
    // }
  }
}
