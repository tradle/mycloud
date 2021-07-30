import _ from 'lodash'
import validateResource from '@tradle/validate-resource'
import { EventEmitter } from 'events'
import { Delivery as DeliveryIot } from './delivery-mqtt'
import { Delivery as DeliveryHTTP } from './delivery-http'
import {
  Messages,
  Env,
  Logger,
  Friends,
  Objects,
  Iot,
  Auth,
  DB,
  ModelStore,
  IDelivery,
  IDeliveryRequest,
  IDeliveryResult,
  ILiveDeliveryOpts,
  ISession
} from './types'

import { ClientUnreachable } from './errors'

const MIN_BATCH_DELIVERY_TIME = 2000
const MAX_BATCH_SIZE = 5

function normalizeOpts(opts) {
  if (!opts.recipient && opts.message) {
    opts.recipient = opts.message._author
  }

  return opts
}

function withTransport(method: string) {
  return async function(opts: any) {
    opts = normalizeOpts({ ...opts, method })
    const transport = await this.getTransport(opts)
    return transport[method](opts)
  }
}

type DeliveryOpts = {
  messages: Messages
  objects: Objects
  friends: Friends
  auth: Auth
  modelStore: ModelStore
  db: DB
  iot: Iot
  env: Env
  logger: Logger
}

export default class Delivery extends EventEmitter implements IDelivery {
  public ack = withTransport('ack')
  public reject = withTransport('reject')
  public mqtt: any
  public http: DeliveryHTTP
  private get friends() {
    return this.components.friends
  }
  private get messages() {
    return this.components.messages
  }
  private get objects() {
    return this.components.objects
  }
  private get env() {
    return this.components.env
  }
  private components: DeliveryOpts
  private logger: Logger
  private _deliverBatch = withTransport('deliverBatch')

  constructor(components: DeliveryOpts) {
    super()

    this.components = components
    this.http = new DeliveryHTTP(components)
    this.mqtt = new DeliveryIot(components)
    this.logger = components.logger
  }

  public deliverBatch = async (opts: ILiveDeliveryOpts) => {
    const messages = opts.messages.map(message => {
      message = validateResource.utils.omitVirtualDeep({
        models: this.components.modelStore.models,
        resource: message
      })

      this.objects.presignEmbeddedMediaLinks({ object: message, stripEmbedPrefix: false })
      return message
    })

    return await this._deliverBatch({ ...opts, messages })
  }

  public deliverMessages = async ({
    recipient,
    session,
    friend,
    range,
    batchSize = MAX_BATCH_SIZE,
    onProgress
  }: IDeliveryRequest): Promise<IDeliveryResult> => {
    range = _.clone(range)
    let { before, after } = range

    this.logger.debug(`looking up messages for ${recipient} > ${after}`)
    const result: IDeliveryResult = {
      finished: false,
      range
    }

    while (true) {
      let messages = await this.messages.getMessagesTo({
        recipient,
        gt: after,
        // lt: before,
        // afterMessage,
        limit: batchSize,
        body: true
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

      await this.deliverBatch({ recipient, messages, session, friend })
      if (onProgress) await onProgress(messages)

      let last = messages[messages.length - 1]
      after = result.range.after = last._time
    }

    return result
  }

  public getTransport = async (opts: {
    method: string
    recipient: string
    clientId?: string
    session?: ISession
    friend?: any
  }): Promise<IDelivery> => {
    const { method, recipient, clientId, session, friend } = opts
    if (clientId || session || !(method in this.http)) {
      this.logger.debug(`Transport 'MQTT/IOT'`)
      return this.mqtt
    }

    if (friend || !(method in this.mqtt)) {
      this.logger.debug(`Transport 'HTTP', friend was passed`)
      return this.http
    }

    try {
      opts.friend = await this.friends.getByIdentityPermalink(recipient)
      this.logger.debug(`Transport 'HTTP', friend was found`)
      return this.http
    } catch (err) {
      this.logger.debug(`cannot determine transport to use for recipient ${recipient}`)
      throw new ClientUnreachable(`${recipient} is unreachable for live delivery`)
    }
  }
}

export { Delivery }
