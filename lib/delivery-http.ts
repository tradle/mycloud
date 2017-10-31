import { EventEmitter } from 'events'
import { post, promiseNoop, tryUntilTimeRunsOut } from './utils'
import { IDelivery, IDeliverBatchRequest } from "./types"
import Env from './env'
import { IDebug } from './types'
import Logger from './logger'

const FETCH_TIMEOUT = 10000

export default class Delivery extends EventEmitter implements IDelivery {
  private env:Env
  private logger:Logger
  constructor(opts: { env:Env }) {
    super()
    this.env = opts.env
    this.logger = this.env.sublogger('delivery-http')
  }

  public ack = promiseNoop
  public reject = (opts: { reason: Error }) => Promise.reject(opts.reason)
  public deliverBatch = async (opts:IDeliverBatchRequest) => {
    const { friend, messages } = opts
    const endpoint = `${friend.url}/inbox`
    return await tryUntilTimeRunsOut(() => post(endpoint, { messages }), {
      env: this.env,
      attemptTimeout: FETCH_TIMEOUT,
      onError: (err:Error) => {
        this.logger.error('failed to delivery messages', { stack: err.stack })
      }
    })
  }
}
