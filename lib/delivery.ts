import { EventEmitter } from 'events'
import * as DeliveryMQTT from './delivery-mqtt'
import DeliveryHTTP from './delivery-http'
import Messages from './messages'
import {
  IDelivery,
  IDeliveryRequest,
  IDeliveryResult,
  IDeliverBatchRequest,
  IDeliveryMessageRange,
  IDebug
} from './types'
import { clone, pick } from './utils'
import { ClientUnreachable } from './errors'
import Env from './env'
import LambdaUtils from './lambda-utils'
import Logger from './logger'

const MIN_BATCH_DELIVERY_TIME = 2000
const MAX_BATCH_SIZE = 5

function normalizeOpts (opts) {
  if (!opts.recipient && opts.message) {
    opts.recipient = opts.message._author
  }

  return opts
}

function withTransport (method: string) {
  return async function (opts: any) {
    opts = normalizeOpts({ ...opts, method })
    const transport = await this.getTransport(opts)
    return transport[method](opts)
  }
}

export default class Delivery extends EventEmitter implements IDelivery {
  public ack = withTransport('ack')
  public reject = withTransport('reject')

  private mqtt: any
  private http: DeliveryHTTP
  private friends: any
  private messages: Messages
  private objects: any
  private env: Env
  private logger: Logger
  private lambdaUtils: LambdaUtils
  private _deliverBatch = withTransport('deliverBatch')

  constructor (opts) {
    super()

    const { friends, messages, objects, env, lambdaUtils } = opts
    this.messages = messages
    this.objects = objects
    this.friends = friends
    this.http = new DeliveryHTTP(opts)
    this.mqtt = new DeliveryMQTT(opts)
    this.env = env
    this.logger = this.env.sublogger('delivery')
    this.lambdaUtils = lambdaUtils
  }

  public deliverBatch = async (opts:IDeliverBatchRequest) => {
    const { messages } = opts
    messages.forEach(object => this.objects.presignEmbeddedMediaLinks({ object }))
    return this._deliverBatch(opts)
  }

  public deliverMessages = async ({
    recipient,
    clientId,
    friend,
    range,
    batchSize=MAX_BATCH_SIZE
  }:IDeliveryRequest):Promise<IDeliveryResult> => {

    let { afterMessage } = range
    const { before, after } = range

    this.logger.debug(`looking up messages for ${recipient} > ${after}`)
    const result:IDeliveryResult = {
      finished: false,
      range: { ...range }
    }

    while (true) {
      let messages = await this.messages.getMessagesTo({
        recipient,
        gt: after,
        lt: before,
        afterMessage,
        limit: batchSize,
        body: true,
      })

      this.logger.debug(`found ${messages.length} messages for ${recipient}`)
      if (!messages.length) {
        result.finished = true
        break
      }

      if (this.env.getRemainingTime() < MIN_BATCH_DELIVERY_TIME) {
        this.logger.info('delivery ran out of time')
        // TODO: recurse
        break
      }

      await this.deliverBatch({ recipient, messages, clientId, friend })
      let last = messages[messages.length - 1]
      afterMessage = pick(last, ['_recipient', 'time'])
      result.range.afterMessage = afterMessage
      delete result.range.after
    }

    return result
  }

  public async getTransport (opts: {
    method: string,
    recipient: string,
    clientId?: string,
    friend?: any
  }):Promise<IDelivery> {
    const { method, recipient, clientId, friend } = opts
    if (clientId || !(method in this.http)) {
      return this.mqtt
    }

    if (friend || !(method in this.mqtt)) {
      return this.http
    }

    try {
      opts.friend = await this.friends.getByIdentityPermalink(recipient)
      return this.http
    } catch (err) {
      this.logger.debug(`cannot determine transport to use for recipient ${recipient}`)
      throw new ClientUnreachable(`${recipient} is unreachable for live delivery`)
    }
  }
}
