import { EventEmitter } from 'events'
import _ from 'lodash'
import { SEQ } from '@tradle/constants'
import Errors from './errors'
import { omitVirtual, batchByByteLength } from './utils'
import {
  IDelivery,
  ILiveDeliveryOpts,
  Messages,
  Objects,
  Auth,
  Logger,
  Iot
} from './types'

// 128KB, but who knows what overhead MQTT adds, so leave a buffer
// would be good to test it and know the hard limit
// but there's also gzip, which cuts size by 5-10x for large JSONs
const MAX_PAYLOAD_SIZE = 120000 * 5

// eventemitter makes testing easier
export default class Delivery extends EventEmitter implements IDelivery {
  private iot: Iot
  private messages: Messages
  private objects: Objects
  private auth: Auth
  private logger: Logger
  private _parentTopic: string
  constructor ({ env, iot, auth, messages, objects, logger }) {
    super()

    this.logger = logger.sub('delivery-iot')
    this.iot = iot
    this.auth = auth
    this.messages = messages
    this.objects = objects
    this._parentTopic = env.IOT_PARENT_TOPIC
  }

  public includesClientMessagesTopic = ({
    clientId,
    topics
  }):boolean => {
    const catchAllTopic = `${clientId}/sub/+`
    const messagesTopic = `${clientId}/sub/inbox`
    return topics
      .map(topic => this._unprefixTopic(topic))
      .find(topic => topic === messagesTopic || topic === catchAllTopic)
  }

  // public canReceive = async ({ clientId, session }) => {
  //   if (!session) {
  //     session = await this.auth.getLiveSessionByPermalink(clientId)
  //   }

  //   return session.authenticated && session.connected
  // }

  public deliverBatch = async ({ session, recipient, messages }:ILiveDeliveryOpts) => {
    if (!(session.authenticated && session.connected)) {
      const status = JSON.stringify(_.pick(session, ['authenticated', 'connected']))
      throw new Errors.ClientUnreachable(`Client is ${status} but must be both`)
    }

    const seqs = messages.map(m => m[SEQ])
    this.logger.debug(`delivering ${messages.length} messages to ${recipient}: ${seqs.join(', ')}`)
    const strings = messages.map(stringify)
    const subBatches = batchByByteLength(strings, MAX_PAYLOAD_SIZE)
    const promises = []
    // this assumes the client has a processing queue
    // that reorders by seq/time
    for (const subBatch of subBatches) {
      const promise = this.trigger({
        clientId: session.clientId,
        topic: 'inbox',
        payload: `{"messages":[${subBatch.join(',')}]}`
      })

      promises.push(promise)
    }

    await Promise.all(promises)
    this.logger.debug(`delivered ${messages.length} messages to ${recipient}`)
  }

  public ack = ({ clientId, message }) => {
    this.logger.debug(`acking message from ${clientId}`)
    const stub = this.messages.getMessageStub({ message })
    return this.trigger({
      clientId,
      topic: 'ack',
      payload: {
        message: stub
      }
    })
  }

  public reject = ({ clientId, message, error }) => {
    this.logger.debug(`rejecting message from ${clientId}`, error)
    const stub = this.messages.getMessageStub({ message, error })
    return this.trigger({
      clientId,
      topic: 'reject',
      payload: {
        message: stub,
        reason: Errors.export(error)
      }
    })
  }

  public trigger = ({ clientId, topic, payload }) => {
    return this.iot.publish({
      topic: this._prefixTopic(`${clientId}/sub/${topic}`),
      payload
    })
  }

  private _prefixTopic = (topic) => {
    return `${this._parentTopic}/${topic}`
  }

  private _unprefixTopic = (topic) => {
    return topic.slice(this._parentTopic.length + 1)
  }
}

const stringify = msg => JSON.stringify(omitVirtual(msg))

export { Delivery }
