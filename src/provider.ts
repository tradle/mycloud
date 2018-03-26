import _ from 'lodash'
import Debug from 'debug'
import { utils } from '@tradle/engine'
import { DB } from '@tradle/dynamodb'
import Embed from '@tradle/embed'
import buildResource from '@tradle/build-resource'
import { ECKey, sign, getSigningKey, getChainKey, getPermalink, addLinks } from './crypto'
import {
  cachifyPromiser,
  setVirtual,
  pickVirtual,
  omitVirtual,
  hasVirtualDeep,
  omitVirtualDeep,
  typeforce,
  summarizeObject,
  series,
  ensureTimestamped,
  ensureNoVirtualProps,
  copyVirtual
} from './utils'

import Errors from './errors'
import * as types from './typeforce-types'
import Env from './env'
import {
  IDENTITY_KEYS_KEY,
  SEQ,
  TYPE,
  TYPES,
  SIG,
  PUBLIC_CONF_BUCKET,
  PERMALINK,
  DB_IGNORE_PAYLOAD_TYPES
} from './constants'

import Tradle from './tradle'
import Auth from './auth'
import Identities from './identities'
import Messages from './messages'
import Objects from './objects'
import {
  Bucket,
  ISession,
  ITradleMessage,
  ITradleObject,
  IIdentity,
  IPubKey,
  IDebug,
  ILiveDeliveryOpts,
  ISendOpts,
  IBatchSendOpts,
  IECMiniPubKey,
  ISaveObjectOpts
} from './types'
import Logger from './logger'

const {
  MESSAGE,
  IDENTITY,
  SELF_INTRODUCTION,
  INTRODUCTION,
  IDENTITY_PUBLISH_REQUEST
} = TYPES

type PayloadWrapper = {
  new: boolean
  asStored: ITradleObject
  asSigned: ITradleObject
}

export default class Provider {
  private tradle: Tradle
  private env: Env
  private objects: Objects
  private messages: Messages
  private secrets: Bucket
  private identities: Identities
  private buckets: any
  private auth: Auth
  private network: any
  public db: DB
  public logger:Logger
  constructor (tradle: Tradle) {
    this.tradle = tradle
    this.env = tradle.env
    this.logger = tradle.env.sublogger('provider')
    this.objects = tradle.objects
    this.messages = tradle.messages
    this.secrets = tradle.secrets
    this.identities = tradle.identities
    this.buckets = tradle.buckets
    this.auth = tradle.auth
    this.network = tradle.network
    this.db = tradle.db
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

  public getMyChainKey = async ():Promise<IECMiniPubKey> => {
    const { network } = this
    if (network.flavor === 'corda') return

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

  public signObject = async ({ object, author }: {
    object: any
    author?: any
  }):Promise<ITradleObject> => {
    const resolveEmbeds = this.objects.resolveEmbeds(object)
    if (!author) author = await this.getMyPrivateIdentity()

    await resolveEmbeds
    const key = getSigningKey(author.keys)
    const signed = await sign({
      key,
      object: omitVirtual(object)
    })

    this.objects.addMetadata(signed)
    this.logger.debug(`signed`, summarizeObject(signed))
    setVirtual(signed, { _author: getPermalink(author.identity) })
    return signed
  }

  public getOrCreatePayload = async ({ link, object, author }):Promise<PayloadWrapper> => {
    const ret = {
      new: object && !object[SIG],
      asStored: null,
      asSigned: null
    }

    if (object) {
      if (ret.new) {
        object = await this.signObject({ author, object })
        ret.asSigned = object
      }

      ret.asStored = await this.saveObject({ object, inbound: false })
    } else {
      ret.asStored = await this.objects.get(link)
    }

    if (!ret.asSigned) {
      ret.asSigned = await this.objects.resolveEmbeds(_.cloneDeep(ret.asStored))
    }

    copyVirtual(ret.asSigned, ret.asStored)
    return ret
  }

  public receiveMessage = async ({
    message,
    clientId
  }: {
    message: any,
    clientId?:string
  }):Promise<ITradleMessage> => {
    ensureNoVirtualProps(message)

    if (clientId) {
      const { object } = message
      const identity = getIntroducedIdentity(object)
      if (identity) {
        // small optimization to avoid validating the same identity
        // we just validated during auth
        const link = buildResource.link(identity)
        const alreadyHaveContact = clientId &&
          !identity[PERMALINK] &&
          link === this.auth.getPermalinkFromClientId(clientId)

        if (!alreadyHaveContact) {
          await this.identities.addContact(identity)
        }
      }
    }

    try {
      return await this._doReceiveMessage({ message })
    } catch (err) {
      err.progress = message
      throw err
    }
  }

  // TODO: run this on message stream
  public watchSealedPayload = async ({ seal, object }) => {
    this.logger.debug('message has seal identifier for payload', seal)

    const { flavor, networkName } = this.network
    if (seal.blockchain === flavor && seal.network === networkName) {
      this.logger.info('placing watch on seal', seal)
      try {
        await this.tradle.seals.watch({
          object,
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

  // public only for testing purposes
  public _doReceiveMessage = async ({ message }):Promise<ITradleMessage> => {
    message = await this.messages.processInbound(message)

    const tasks:Promise<any>[] = [
      this.saveObject({ object: message.object, inbound: true }),
      this.messages.putMessage(message)
    ]

    if (message.seal) {
      tasks.push(this.watchSealedPayload(message))
    }

    const [payload] = await Promise.all(tasks)
    message.object = payload
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
    const byRecipient = _.groupBy(batch, 'recipient')
    const results = await Promise.all(Object.keys(byRecipient).map(recipient => {
      return this._sendMessageBatch(byRecipient[recipient])
    }))

    return _.flatten(results)
  }

  public _sendMessageBatch = async (batch: IBatchSendOpts):Promise<ITradleMessage[]> => {
    const { recipient } = batch[0]
    this.logger.debug(`sending batch of ${batch.length} messages to ${recipient}`)
    const messages = await series(batch.map(
      sendOpts => () => this._doSendMessage(sendOpts))
    )

    return messages
  }

  public sendMessage = async (opts: ISendOpts):Promise<ITradleMessage> => {
    const results = await this.sendMessageBatch([opts])
    return results[0]
  }

  public attemptLiveDelivery = async (opts: ILiveDeliveryOpts) => {
    const { recipient, messages } = opts
    if (!messages.length) return

    const promiseSession = opts.session
      ? Promise.resolve(opts.session)
      : this.auth.getLiveSessionByPermalink(recipient).catch(err => {
          Errors.ignore(err, { name: 'NotFound' })
          this.logger.debug('iot session not found for counterparty', { permalink: recipient })
          return undefined
        })

    const promiseFriend = opts.friend
      ? Promise.resolve(opts.friend)
      : this.tradle.friends.getByIdentityPermalink(recipient).catch(err => {
          Errors.ignore(err, { name: 'NotFound' })
          this.logger.debug('friend not found for counterparty', { permalink: recipient })
          return undefined
        })

    try {
      await this._attemptLiveDelivery({
        ...opts,
        session: await promiseSession,
        friend: await promiseFriend
      })
    } catch (err) {
      const error = { error: err.stack }
      if (Errors.isNotFound(err)) {
        this.logger.debug('live delivery canceled', error)
      } else if (Errors.matches(err, Errors.ClientUnreachable)) {
        this.logger.debug('live delivery failed, client unreachable', { recipient })
        if (this.tradle.pushNotifications) {
          try {
            await this.sendPushNotification(recipient)
          } catch (pushErr) {
            this.logger.error('failed to send push notification', { message: err.message })
          }
        }
      } else {
        // rethrow, as this is likely a developer error
        this.logger.error('live delivery failed due, likely to developer error', {
          messages,
          ...error
        })

        throw err
      }
    }
  }

  private _attemptLiveDelivery = async (opts: ILiveDeliveryOpts) => {
    const { messages, recipient } = opts
    this.logger.debug(`attempting to deliver batch of ${messages.length} messages to ${recipient}`)
    await this.tradle.delivery.deliverBatch({
      ...opts,
      messages: messages.map(this.messages.formatForDelivery)
    })
  }

  public sendPushNotification = async (recipient:string):Promise<void> => {
    const { identity, keys } = await this.tradle.provider.getMyPrivateIdentity()
    await this.tradle.pushNotifications.push({
      key: getSigningKey(keys),
      identity,
      subscriber: recipient
    })
  }

  public registerWithPushNotificationsServer = async ():Promise<void> => {
    const { identity, keys } = await this.tradle.provider.getMyPrivateIdentity()
    await this.tradle.pushNotifications.ensureRegistered({
      key: getSigningKey(keys),
      identity
    })
  }

  public lookupMyIdentity = ():Promise<any> => {
    return this.secrets.getJSON(IDENTITY_KEYS_KEY)
  }

  public lookupMyPublicIdentity = async ():Promise<IIdentity> => {
    const val = await this.buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.identity)
    return val as IIdentity
  }

  public getMyPrivateIdentity = cachifyPromiser(this.lookupMyIdentity)

  public getMyPublicIdentity:() => Promise<IIdentity> =
    cachifyPromiser(this.lookupMyPublicIdentity)

  // public for testing purposes
  public _doSendMessage = async (opts):Promise<ITradleMessage> => {
    typeforce({
      recipient: types.link,
      object: typeforce.maybe(typeforce.Object),
      other: typeforce.maybe(typeforce.Object),
    }, opts)

    if (!opts.time) {
      opts.time = Date.now()
    }

    if (!opts.author) {
      opts.author = await this.getMyPrivateIdentity()
    }

    const { author, recipient, link, object, other={} } = opts

    // run in parallel
    const promisePayload = this.getOrCreatePayload({ link, object, author })
    const promisePrev = this.messages.getLastSeqAndLink({ recipient })
    const promiseRecipient = this.identities.byPermalink(recipient)
    const [payload, recipientObj] = await Promise.all([
      promisePayload,
      promiseRecipient
    ])

    // the signature will be validated against the object with
    // media embeded as data urls
    const payloadVirtual = pickVirtual(payload.asSigned)
    const unsignedMessage = _.extend({}, other, {
      [TYPE]: MESSAGE,
      recipientPubKey: utils.sigPubKey(recipientObj),
      object: omitVirtual(payload.asSigned),
      time: opts.time
    })

    // TODO:
    // efficiency can be improved
    // message signing can be done in parallel with putObject in getOrCreatePayload

    let attemptsToGo = 3
    let prev = await promisePrev
    let seq
    let signedMessage
    while (attemptsToGo--) {
      _.extend(unsignedMessage, this.messages.getPropsDerivedFromLast(prev))

      seq = unsignedMessage[SEQ]
      this.logger.debug(`signing message ${seq} to ${recipient}`)
      signedMessage = await this.signObject({ author, object: unsignedMessage })
      setVirtual(signedMessage, {
        _author: getPermalink(author.identity),
        _recipient: getPermalink(recipientObj)
      })

      setVirtual(signedMessage.object, payloadVirtual)
      try {
        await this.messages.putMessage(signedMessage)
        signedMessage.object = payload.asStored
        return signedMessage
      } catch (err) {
        Errors.ignore(err, Errors.Duplicate)
        this.logger.info(`seq was taken by another message, retrying`, {
          seq,
          recipient
        })

        prev = await this.messages.getLastSeqAndLink({ recipient })
      }
    }

    throw new Errors.CloudServiceError({
      service: 'dynamodb',
      message: 'failed to create outbound message after 3 retries',
      retryable: true
    })
  }

  public saveObject = async ({ object, inbound, merge }: ISaveObjectOpts) => {
    object = _.cloneDeep(object)
    this.objects.addMetadata(object)
    ensureTimestamped(object)
    await this.objects.replaceEmbeds(object)
    await Promise.all([
      this.objects.put(object),
      this.putInDB({ object, inbound, merge })
    ])

    return object
  }

  public getMyIdentityPermalink = async ():Promise<string> => {
    const { _permalink } = await this.getMyPublicIdentity()
    return _permalink
  }

  private isAuthoredByMe = async (object:ITradleObject) => {
    const promiseMyPermalink = this.getMyIdentityPermalink()
    let { _author } = object
    if (!_author) {
      ({ _author } = await this.identities.getAuthorInfo(object))
    }

    const myPermalink = await promiseMyPermalink
    return _author === myPermalink
  }

  private putInDB = async ({ object, inbound, merge }: ISaveObjectOpts) => {
    // const inbound = await this.isAuthoredByMe(object)
    const type = object[TYPE]
    const ignored = inbound
      ? DB_IGNORE_PAYLOAD_TYPES.inbound
      : DB_IGNORE_PAYLOAD_TYPES.outbound

    if (ignored.includes(type)) {
      this.logger.debug(`not saving ${type} to type-differentiated table`)
      return false
    }

    try {
      await this.db.getTableForModel(type)
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.debug(`not saving "${type}", don't have a table for it`, Errors.export(err))
      return false
    }

    const method = merge ? 'update' : 'put'
    await this.db[method](object)
    return true
  }
}

export { Provider }

const getIntroducedIdentity = (payload) => {
  const type = payload[TYPE]
  if (type === IDENTITY) return payload

  if (type === SELF_INTRODUCTION || type === INTRODUCTION || type === IDENTITY_PUBLISH_REQUEST) {
    return payload.identity
  }
}
