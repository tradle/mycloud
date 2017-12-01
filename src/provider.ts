import Debug from 'debug'
import dotProp = require('dot-prop')
import { utils } from '@tradle/engine'
import Embed = require('@tradle/embed')
import { ECKey, sign, getSigningKey, getChainKey, getPermalink } from './crypto'
import {
  cachifyPromiser,
  extend,
  clone,
  setVirtual,
  pickVirtual,
  typeforce,
  summarizeObject,
  series,
  flatten,
  ensureTimestamped
} from './utils'

import Errors = require('./errors')
import types = require('./typeforce-types')
import {
  IDENTITY_KEYS_KEY,
  SEQ,
  TYPE,
  TYPES,
  SIG,
  PUBLIC_CONF_BUCKET
} from './constants'

import Tradle from './tradle'
import Auth from './auth'
import Identities from './identities'
import Messages from './messages'
import Objects from './objects'
import Env from './env'
import {
  ISession,
  ITradleMessage,
  ITradleObject,
  IIdentity,
  IPubKey,
  IDebug,
  ILiveDeliveryOpts,
  ISendOpts,
  IBatchSendOpts
} from './types'
import Logger from './logger'

const { MESSAGE } = TYPES

export default class Provider {
  private tradle: Tradle
  private logger:Logger
  private objects: Objects
  private messages: Messages
  private secrets: any
  private identities: Identities
  private buckets: any
  private auth: Auth
  private network: any
  constructor (tradle: Tradle) {
    this.tradle = tradle
    this.logger = tradle.env.sublogger('provider')
    this.objects = tradle.objects
    this.messages = tradle.messages
    this.secrets = tradle.secrets
    this.identities = tradle.identities
    this.buckets = tradle.buckets
    this.auth = tradle.auth
    this.network = tradle.network
  }

  // get objects() { return this.tradle.objects }
  // get messages() { return this.tradle.messages }
  // get secrets() { return this.tradle.secrets }
  // get identities() { return this.tradle.identities }
  // get buckets() { return this.tradle.buckets }
  // get auth() { return this.tradle.auth }
  // get network() { return this.tradle.network }

  // TODO: how to invalidate cache on identity updates?
  // maybe ETag on bucket item? But then we still need to request every time..
  public getMyKeys = async ():Promise<any> => {
    const { keys } = await this.getMyPrivateIdentity()
    return keys
  }

  public getMyChainKey = async ():Promise<any> => {
    const { network } = this
    const keys = await this.getMyKeys()
    const chainKey = getChainKey(keys, {
      type: network.flavor,
      networkName: network.networkName
    })

    if (!chainKey) {
      throw new Error(`blockchain key not found for network: ${network}`)
    }

    return chainKey
  }

  public getMyChainKeyPub = async ():Promise<IPubKey> => {
    const { network } = this
    const identity = await this.getMyPublicIdentity()
    const key = identity.pubkeys.find(pub => {
      return pub.type === network.flavor &&
        pub.networkName === network.networkName &&
        pub.purpose === 'messaging'
    })

    if (!key) {
      throw new Error(`no key found for blockchain network ${network.toString()}`)
    }

    return key
  }

  public getMySigningKey = async ():Promise<ECKey> => {
    const { keys } = await this.getMyPrivateIdentity()
    return getSigningKey(keys)
  }

  public signObject = async ({ author, object }):Promise<ITradleObject> => {
    if (!author) author = await this.getMyPrivateIdentity()

    const key = getSigningKey(author.keys)
    const signed = await sign({ key, object })

    this.objects.addMetadata(signed)
    this.logger.debug(`signed`, summarizeObject(signed))
    setVirtual(signed, { _author: getPermalink(author.identity) })
    return signed
  }

  public findOrCreate = async ({ link, object, author }):Promise<ITradleObject> => {
    if (!object) {
      return this.objects.get(link)
    }

    if (!object[SIG]) {
      object = await this.signObject({ author, object })
    }

    await this.objects.put(object)
    this.objects.addMetadata(object)
    return object
  }

  public createSendMessageEvent = async (opts):Promise<ITradleMessage> => {
    if (!opts.time) {
      opts.time = Date.now()
    }

    if (!opts.author) {
      opts.author = await this.getMyPrivateIdentity()
    }

    return await this._createSendMessageEvent(opts)
  }

  public receiveMessage = async ({ message }):Promise<ITradleMessage> => {
    // can probably move this to lamdba
    // as it's normalizing transport-mangled inputs
    try {
      message = this.messages.normalizeInbound(message)
      message = await this.messages.preProcessInbound(message)
    } catch (err) {
      err.progress = message
      this.logger.error('unexpected error in pre-processing inbound message:', {
        message,
        error: err.stack
      })

      throw err
    }

    try {
      return await this.createReceiveMessageEvent({ message })
    } catch (err) {
      err.progress = message
      throw err
    }
  }

  public watchSealedPayload = async ({ seal, object }) => {
    this.logger.debug('message has seal identifier for payload', seal)

    const { flavor, networkName } = this.network
    if (seal.blockchain === flavor && seal.network === networkName) {
      this.logger.info('placing watch on seal', seal)
      try {
        await this.tradle.seals.watch({
          link: seal.link,
          key: {
            type: this.network.flavor,
            curve: this.network.curve,
            pub: seal.basePubKey.toString('hex')
          }
        })
      } catch (err) {
        Errors.ignore(err, Errors.Duplicate)
      }
    } else {
      this.logger.warn('seal is on a different network, ignoring for now')
    }
  }

  public createReceiveMessageEvent = async ({ message }):Promise<ITradleMessage> => {
    message = await this.messages.parseInbound(message)

    const tasks = [
      this.objects.put(message.object),
      this.messages.putMessage(message)
    ]

    if (message.seal) {
      tasks.push(this.watchSealedPayload(message))
    }

    await Promise.all(tasks)
    return message
  }

  // const ensureMessageIsForMe = co(function* ({ message }) {
  //   const toPubKey = message.recipientPubKey.pub.toString('hex')
  //   const recipient = await getMyPublicIdentity()
  //   const myPubKey = recipient.object.pubkeys.find(pubKey => {
  //     return pubKey.pub === toPubKey
  //   })

  //   if (!myPubKey) {
  //     this.debug(`ignoring message meant for someone else (with pubKey: ${toPubKey}) `)
  //     throw new Errors.MessageNotForMe(`message to pub key: ${toPubKey}`)
  //   }
  // })

  public sendMessageBatch = async (batch: IBatchSendOpts):Promise<ITradleMessage[]> => {
    const byRecipient = {}
    batch.forEach(message => {
      const { recipient } = message
      if (!byRecipient[recipient]) {
        byRecipient[recipient] = []
      }

      byRecipient[recipient].push(message)
    })

    const results = await Promise.all(Object.keys(byRecipient).map(recipient => {
      return this._sendMessageBatch(byRecipient[recipient])
    }))

    return flatten(results)
  }

  public _sendMessageBatch = async (batch: IBatchSendOpts):Promise<ITradleMessage[]> => {
    // start this first to get a more accurate timestamp
    const { recipient } = batch[0]
    const promiseCreates = series(batch.map(sendOpts =>
      () => this.createSendMessageEvent(sendOpts)))

    const promiseSession = this.auth.getLiveSessionByPermalink(recipient)
      .catch(err => {
        Errors.ignore(err, { name: 'NotFound' })
        this.logger.debug('mqtt session not found for counterparty', { permalink: recipient })
        return undefined
      })

    const promiseFriend = this.tradle.friends.getByIdentityPermalink(recipient)
      .catch(err => {
        Errors.ignore(err, { name: 'NotFound' })
        this.logger.debug('friend not found for counterparty', { permalink: recipient })
        return undefined
      })

    const session = await promiseSession
    const friend = await promiseFriend
    const messages = await promiseCreates
    await this.attemptLiveDelivery({ recipient, messages, session, friend })
    return messages
  }

  public sendMessage = async (opts: ISendOpts):Promise<ITradleMessage> => {
    const results = await this.sendMessageBatch([opts])
    return results[0]
  }

  public attemptLiveDelivery = async (opts: ILiveDeliveryOpts) => {
    const { messages, recipient, session, friend } = opts
    try {
      await this._attemptLiveDelivery(opts)
    } catch (err) {
      const error = { error: err.stack }
      if (err instanceof Errors.NotFound) {
        this.logger.debug('live delivery canceled', error)
      } else if (err instanceof Errors.ClientUnreachable) {
        this.logger.debug('live delivery failed, client unreachable', error)
        if (this.tradle.pushNotifications) {
          try {
            await this.sendPushNotification(recipient)
          } catch (pushErr) {
            this.logger.error('failed to send push notification', pushErr)
          }
        }
      } else {
        // rethrow, as this is likely a developer error
        this.logger.error('live delivery failed due, likely to developer error', {
          messages,
          ...error
        })
      }
    }
  }

  private _attemptLiveDelivery = async (opts: ILiveDeliveryOpts) => {
    const { messages, recipient } = opts
    this.logger.debug(`attempting to deliver batch of ${messages.length} messages to ${recipient}`)
    await this.tradle.delivery.deliverBatch(opts)
  }

  public sendPushNotification = async (recipient:string):Promise<void> => {
    const { identity, keys } = await this.tradle.provider.getMyPrivateIdentity()
    await this.tradle.pushNotifications.push({
      key: getSigningKey(keys),
      identity,
      subscriber: recipient
    })
  }

  public lookupMyIdentity = ():Promise<any> => {
    return this.secrets.get(IDENTITY_KEYS_KEY)
  }

  public lookupMyPublicIdentity = ():Promise<IIdentity> => {
    return this.buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.identity)
  }

  public getMyPrivateIdentity = cachifyPromiser(this.lookupMyIdentity)

  public getMyPublicIdentity:() => Promise<IIdentity> =
    cachifyPromiser(this.lookupMyPublicIdentity)

  private _createSendMessageEvent = async (opts):Promise<ITradleMessage> => {
    const { author, recipient, link, object, other={} } = opts

    typeforce({
      recipient: types.link,
      object: typeforce.maybe(typeforce.Object),
      other: typeforce.maybe(typeforce.Object),
    }, opts)

    // run in parallel
    const promisePayload = this.findOrCreate({ link, object, author })
    const promisePrev = this.messages.getLastSeqAndLink({ recipient })
    const promiseRecipient = this.identities.byPermalink(recipient)
    const [payload, recipientObj] = await Promise.all([
      promisePayload,
      promiseRecipient
    ])

    const embeds = Embed.getEmbeds(payload)
    // the signature will be validated against the object with
    // media embeded as data urls
    await this.objects.resolveEmbeds(payload)
    const payloadVirtual = pickVirtual(payload)
    const unsignedMessage = clone(other, {
      [TYPE]: MESSAGE,
      recipientPubKey: utils.sigPubKey(recipientObj),
      object: payload,
      time: opts.time
    })

    // TODO:
    // efficiency can be improved
    // message signing can be done in parallel with putObject in findOrCreate

    let attemptsToGo = 3
    let prev = await promisePrev
    let seq
    let signedMessage
    while (attemptsToGo--) {
      extend(unsignedMessage, this.messages.getPropsDerivedFromLast(prev))

      seq = unsignedMessage[SEQ]
      signedMessage = await this.signObject({ author, object: unsignedMessage })
      setVirtual(signedMessage, {
        _author: getPermalink(author.identity),
        _recipient: getPermalink(recipientObj)
      })

      setVirtual(signedMessage.object, payloadVirtual)
      try {
        await this.messages.putMessage(signedMessage)
        // restore embed links
        for (let embed of embeds) {
          dotProp.set(signedMessage.object, embed.path, embed.value)
        }

        return signedMessage
      } catch (err) {
        if (err.code !== 'ConditionalCheckFailedException') {
          throw err
        }

        this.logger.info(`seq was taken by another message, retrying`, {
          seq,
          recipient
        })

        prev = await this.messages.getLastSeqAndLink({ recipient })
      }
    }

    const err = new Errors.PutFailed('failing after 3 retries')
    err.retryable = true
    throw err
  }
}
