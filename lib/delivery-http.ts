import { EventEmitter } from 'events'
import { post, promiseNoop, tryUntilTimeRunsOut } from './utils'
import { IDelivery } from "./types"
import Env from './env'
import { IDebug } from './types'

const FETCH_TIMEOUT = 10000

export default class Delivery extends EventEmitter implements IDelivery {
  private env:Env
  private debug:IDebug
  constructor(opts: { env:Env }) {
    super()
    this.env = opts.env
    this.debug = this.env.logger('delivery-http')
  }

  public ack = promiseNoop
  public reject = (opts: { reason: Error }) => Promise.reject(opts.reason)
  public deliverBatch = async (opts: { friend: any; recipient: string; messages: Array<any> }) => {
    const { friend, messages } = opts
    const endpoint = `${friend.url}/inbox`
    return await tryUntilTimeRunsOut(() => post(endpoint, { messages }), {
      env: this.env,
      attemptTimeout: FETCH_TIMEOUT,
      onError: (err:Error) => {
        this.debug('failed to delivery messages', err.stack)
      }
    })
  }
}
