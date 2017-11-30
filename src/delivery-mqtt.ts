import { EventEmitter } from 'events'
import { SEQ } from '@tradle/constants'
import { co, typeforce, pick } from './utils'
import Errors = require('./errors')
import { omitVirtual, extend, batchStringsBySize, bindAll } from './utils'
import { getLink } from './crypto'
import { IDelivery } from './types'
import Messages from './messages'
import Objects from './objects'
import Env from './env'
import Auth from './auth'
import Logger from './logger'

// 128KB, but who knows what overhead MQTT adds, so leave a buffer
// would be good to test it and know the hard limit
const MAX_PAYLOAD_SIZE = 115000

// eventemitter makes testing easier
export default class DeliveryIot extends EventEmitter implements IDelivery {
  private env: Env
  private iot: any
  private messages: Messages
  private objects: Objects
  private auth: Auth
  private logger: Logger
  private _parentTopic: string
  constructor ({ env, iot, auth, messages, objects }) {
    super()

    this.env = env
    this.logger = env.sublogger('delivery-iot')
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

  public canReceive = async ({ clientId, session }) => {
    if (!session) {
      session = await this.auth.getMostRecentSessionByClientId(clientId)
    }

    return session.authenticated && session.connected
  }

  public deliverBatch = async ({ session, recipient, messages }) => {
    if (!(session.authenticated && session.connected)) {
      throw new Errors.ClientUnreachable('client must be authenticated and connected')
    }

    const seqs = messages.map(m => m[SEQ])
    this.logger.debug(`delivering ${messages.length} messages to ${recipient}: ${seqs.join(', ')}`)
    const strings = messages.map(stringify)
    const subBatches = batchStringsBySize(strings, MAX_PAYLOAD_SIZE)
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
