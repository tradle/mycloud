import yn = require('yn')
import { EventEmitter } from 'events'
import { post, promiseNoop, timeoutIn, tryUntilTimeRunsOut, gzip } from './utils'
import { IDelivery, ILiveDeliveryOpts } from "./types"
import { IDebug } from './types'
import Logger from './logger'
import Env from './env'
import Errors = require('./errors')

const COMPRESSION_THRESHOLD = 1024
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
  public deliverBatch = async (opts:ILiveDeliveryOpts) => {
    const { recipient, friend, messages, timeout } = opts
    const endpoint = `${friend.url}/inbox`
    const headers = {}
    let payload = JSON.stringify({ messages })
    if (!this.env.IS_OFFLINE && payload.length > COMPRESSION_THRESHOLD) {
      this.logger.debug('gzipping payload')
      payload = await gzip(payload)
      headers['Content-Encoding'] = 'gzip'
    }

    await tryUntilTimeRunsOut(() => post(endpoint, payload, { headers }), {
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

export { Delivery }
