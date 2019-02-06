import _ from 'lodash'
import { protocol } from '@tradle/engine'
import { DB } from '@tradle/dynamodb'
import buildResource from '@tradle/build-resource'
import { getPermalink, getSigningKey } from './crypto'
import {
  setVirtual,
  pickVirtual,
  omitVirtual,
  typeforce,
  series,
  ensureNoVirtualProps,
  copyVirtual,
  summarizeObject,
  // proxyProps,
} from './utils'

import Errors from './errors'
import * as types from './typeforce-types'
import Env from './env'
import {
  SEQ,
  PREVLINK,
  OWNER,
  TYPE,
  TYPES,
  SIG,
  AUTHOR,
  ORG,
  PERMALINK,
  DB_IGNORE_PAYLOAD_TYPES,
  FORBIDDEN_PAYLOAD_TYPES,
} from './constants'

import {
  ITradleMessage,
  ITradleObject,
  ILiveDeliveryOpts,
  ISendOpts,
  IBatchSendOpts,
  Friends,
  Logger,
  Auth,
  Identities,
  Messages,
  Objects,
  Push,
  Seals,
  ModelStore,
  Delivery,
  Identity,
  Storage,
  TaskManager,
  ISession,
} from './types'

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

type MessagingOpts = {
  env: Env
  logger: Logger
  identities: Identities
  identity: Identity
  storage: Storage
  messages: Messages
  auth: Auth
  friends: Friends
  delivery: Delivery
  seals: Seals
  modelStore: ModelStore
  pushNotifications: Push
  tasks: TaskManager
  network: any
}

export default class Messaging {
  private env: Env
  private get messages() { return this.components.messages }
  private get identities() { return this.components.identities }
  private get identity() { return this.components.identity }
  private get auth() { return this.components.auth }
  private get delivery() { return this.components.delivery }
  private get friends() { return this.components.friends }
  private get storage() { return this.components.storage }
  private get modelStore() { return this.components.modelStore }
  private get seals() { return this.components.seals }
  private get pushNotifications() { return this.components.pushNotifications }
  private get tasks() { return this.components.tasks }
  private network: any
  private components: MessagingOpts
  private logger:Logger
  constructor (components: MessagingOpts) {
    this.components = components
    const { env, logger, network } = components

    this.env = env
    this.logger = logger
    this.network = network
    // _.extend(this, proxyProps(this.components, ['objects', 'messages', 'identities', 'identity', 'auth', 'db', 'delivery']))
  }

  public getOrCreatePayload = async ({ link, object, author }):Promise<PayloadWrapper> => {
    const ret = {
      new: object && !object[SIG],
      asStored: null,
      asSigned: null
    }

    if (object) {
      if (ret.new) {
        object = await this.identity.sign({ author, object })
        ret.asSigned = object
      }

      const type = object[TYPE]
      const saveToDB = !DB_IGNORE_PAYLOAD_TYPES.outbound.includes(type)
      if (!saveToDB) {
        this.logger.debug(`not saving ${type} to type-differentiated table`)
      }

      ret.asStored = await this.storage.save({ object, saveToDB })
    } else {
      ret.asStored = await this.storage.getByLink(link)
    }

    if (!ret.asSigned) {
      ret.asSigned = await this.storage.resolveEmbeds(_.cloneDeep(ret.asStored))
    }

    copyVirtual(ret.asSigned, ret.asStored)
    return ret
  }

  public receiveMessage = async ({
    message,
    clientId,
    session,
  }: {
    message: any
    clientId?:string
    session?: ISession
  }):Promise<ITradleMessage> => {
    ensureNoVirtualProps({
      models: this.modelStore.models,
      resource: message
    })

    const { object } = message
    if (FORBIDDEN_PAYLOAD_TYPES.includes(object[TYPE])) {
      this.logger.warn('received payload with forbidden type', { message })
      throw new Errors.Forbidden(`payload ${object[TYPE]}`)
    }

    const identity = getIntroducedIdentity(object)
    if (identity) {
      // small optimization to avoid validating the same identity
      // we just validated during auth
      let alreadyHaveContact
      if (clientId && !identity[PERMALINK]) {
        const clientIdentityPermalink = this.auth.getPermalinkFromClientId(clientId)
        alreadyHaveContact = clientIdentityPermalink === this.auth.getPermalinkFromClientId(clientId)
      }

      if (!alreadyHaveContact) {
        await this.identities.addContact(identity)
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

    const { blockchain, networkName } = this.network
    if (seal.blockchain === blockchain && seal.network === networkName) {
      this.logger.info('placing watch on seal', seal)
      try {
        await this.seals.watch({
          object,
          key: {
            type: this.network.blockchain,
            curve: this.network.curve,
            pub: seal.basePubKey
            // TODO: add txId if available
          },
          ..._.pick(seal, ['headerHash', 'prevHeaderHash', 'link', 'prevlink'])
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
    message = await this.normalizeAndValidateInboundMessage(message)

    this.logger.debug('receiving message', summarizeObject(message))

    const saveToDB = !DB_IGNORE_PAYLOAD_TYPES.inbound.includes(message.object[TYPE])
    const tasks:Promise<any>[] = [
      this.storage.save({ object: message.object, saveToDB }),
      this.messages.save(message)
    ]

    if (message.seal) {
      tasks.push(this.watchSealedPayload(message))
    }

    // prime cache
    this.tasks.add({
      name: 'getauthor',
      promiser: () => this.identities.byPermalink(message._author).catch(Errors.ignoreNotFound)
    })

    const [payload] = await Promise.all(tasks)
    message.object = payload
    return message
  }

  public normalizeAndValidateInboundMessage = async (message: ITradleMessage):Promise<ITradleMessage> => {
    // TODO: uncomment below, check that message is for us
    // await ensureMessageIsForMe({ message })
    // const payload = message.object

    if (message.seal) {
      message.seal.basePubKey = normalizeBuffer(message.seal.basePubKey)
    }

    // prereq to running validation
    await this.storage.resolveEmbeds(message)

    const payload = message.object

    this.storage.addMetadata(message)
    this.storage.addMetadata(payload)

    // TODO:
    // would be nice to parallelize some of these
    // await assertNotDuplicate(messageWrapper.link)

    if (payload[PREVLINK]) {
      // prime cache
      this.logger.debug('TODO: validate against previous version')
      // this.objects.prefetch(payload[PREVLINK])
    }

    const verifyMessageAuthor = this.identities.verifyAuthor(message)
    let verifyPayloadAuthor
    if (payload._sigPubKey === message._sigPubKey) {
      verifyPayloadAuthor = verifyMessageAuthor
    } else {
      verifyPayloadAuthor = Promise.all([
        this.identities.verifyAuthor(payload),
        this._maybeVerifyOrgAuthor(payload)
      ])
    }

    await Promise.all([
      verifyMessageAuthor
        .then(() => this.logger.debug('loaded message author')),
      verifyPayloadAuthor
        .then(() => this.logger.debug('loaded payload author')),
    ])

    if (payload[PREVLINK]) {
      this.logger.warn(`validation of new versions of objects is temporarily disabled,
        until employees switch to command-based operation, rather than re-signing`)

      // try {
      //   await this.objects.validateNewVersion({ object: payload })
      // } catch (err) {
      //   if (!(err instanceof Errors.NotFound)) {
      //     throw err
      //   }

      //   this.debug(`previous version of ${payload._link} (${payload[PREVLINK]}) was not found, skipping validation`)
      // }
    }

    this.logger.debug('added metadata for message and wrapper')
    if (this.env.NO_TIME_TRAVEL) {
      await this.messages.assertTimestampIncreased(message)
    }

    setVirtual(message, {
      _inbound: true
    })

    return message
  }

  // const ensureMessageIsForMe = co(function* ({ message }) {
  //   const toPubKey = message.recipientPubKey.pub.toString('hex')
  //   const recipient = await getPublic()
  //   const myPubKey = recipient.object.pubkeys.find(pubKey => {
  //     return pubKey.pub === toPubKey
  //   })

  //   if (!myPubKey) {
  //     this.debug(`ignoring message meant for someone else (with pubKey: ${toPubKey}) `)
  //     throw new Errors.MessageNotForMe(`message to pub key: ${toPubKey}`)
  //   }
  // })

  public queueMessageBatch = async (batch: IBatchSendOpts):Promise<ITradleMessage[]> => {
    const byRecipient = _.groupBy(batch, 'recipient')
    const results = await Promise.all(Object.keys(byRecipient).map(recipient => {
      return this._queueMessageBatch(byRecipient[recipient])
    }))

    return _.flatten(results)
  }

  public _queueMessageBatch = async (batch: IBatchSendOpts):Promise<ITradleMessage[]> => {
    const { recipient } = batch[0]
    this.logger.debug(`sending batch of ${batch.length} messages to ${recipient}`)
    const messages = await series(batch.map(
      sendOpts => () => this._doQueueMessage(sendOpts))
    )

    return messages
  }

  public queueMessage = async (opts: ISendOpts):Promise<ITradleMessage> => {
    const results = await this.queueMessageBatch([opts])
    return results[0]
  }

  public attemptLiveDelivery = async (opts: ILiveDeliveryOpts) => {
    const { recipient, messages } = opts
    if (!messages.length) return

    const promiseSession = opts.session
      ? Promise.resolve(opts.session)
      : this.auth.getLiveSessionByPermalink(recipient).catch(err => {
          Errors.ignoreNotFound(err)
          this.logger.debug('iot session not found for counterparty', { permalink: recipient })
          return undefined
        })

    const promiseFriend = opts.friend
      ? Promise.resolve(opts.friend)
      : this.friends.getByIdentityPermalink(recipient).catch(err => {
          Errors.ignoreNotFound(err)
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
        if (this.pushNotifications) {
          try {
            await this.sendPushNotification(recipient)
          } catch (pushErr) {
            this.logger.error('failed to send push notification', { message: pushErr.stack })
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

  private _maybeVerifyOrgAuthor = async (object) => {
    if (!object[ORG]) return

    await this.identities.verifyOrgAuthor(object)
  }

  private _attemptLiveDelivery = async (opts: ILiveDeliveryOpts) => {
    const { messages, recipient, friend } = opts
    if (friend) {
      const yay = await this._deliverPreviouslyUndelivered(opts)
      if (!yay) return
    }

    this.logger.debug(`attempting to deliver batch of ${messages.length} messages to ${recipient}`)
    await this.delivery.deliverBatch({
      ...opts,
      messages: messages.map(this.messages.formatForDelivery)
    })
  }

  public resumeDelivery = async (opts: {
    recipient: string
    friend?: any
  }) => {
    const ok = await this.delivery.http.resetError({
      counterparty: opts.recipient
    })

    if (!ok) return false

    await this._deliverPreviouslyUndelivered(opts)
  }

  private _deliverPreviouslyUndelivered = async (opts: {
    recipient: string
    friend?: any
  }):Promise<boolean> => {
    const { recipient, friend } = opts

    let deliveryError
    try {
      deliveryError = await this.delivery.http.getError(recipient)
    } catch (err) {
      this.logger.debug(`no delivery error found for ${recipient}`)
      Errors.ignoreNotFound(err)
      return true
    }

    if (this.delivery.http.isStuck(deliveryError)) {
      return false
    }

    this.logger.debug('delivering previously undelivered messages', deliveryError)
    const result = await this.delivery.deliverMessages({
      recipient,
      friend,
      range: this.delivery.http.getRangeFromError(deliveryError)
    })

    if (!result.finished) {
      return false
    }

    return true
  }

  public sendPushNotification = async (recipient:string):Promise<void> => {
    const { identity, keys } = await this.identity.getPrivate()
    await this.pushNotifications.push({
      key: getSigningKey(keys),
      identity,
      subscriber: recipient
    })
  }

  public registerWithPushNotificationsServer = async ():Promise<void> => {
    const { identity, keys } = await this.identity.getPrivate()
    await this.pushNotifications.ensureRegistered({
      key: getSigningKey(keys),
      identity
    })
  }

  // public for testing purposes
  public _doQueueMessage = async (opts):Promise<ITradleMessage> => {
    typeforce({
      recipient: types.link,
      object: typeforce.maybe(typeforce.Object),
      other: typeforce.maybe(typeforce.Object),
    }, opts)

    if (!opts.author) {
      opts.author = await this.identity.getPrivate()
    }

    const { author, recipient, link, object, other={}, time=Date.now() } = opts

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
    const unsignedMessage = await this.identity.draft(_.extend({}, other, {
      [TYPE]: MESSAGE,
      // recipientPubKey: utils.sigPubKey(recipientObj),
      object: omitVirtual(payload.asSigned),
      _recipient: getPermalink(recipientObj),
      _time: time
    }))

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
      signedMessage = await this.identity.sign({ author, object: unsignedMessage })
      setVirtual(signedMessage.object, payloadVirtual)
      try {
        await this.messages.save(signedMessage)
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

  public validateNewVersion = async (opts: { object: ITradleObject }) => {
    const { identities } = this
    const { object } = opts
    const link = protocol.link(object)
    const [
      prev,
      orig
    ] = await Promise.all([
      this.storage.getByLink(object[PREVLINK]).catch(Errors.ignoreNotFound),
      this.storage.getByLink(object[PERMALINK]).catch(Errors.ignoreNotFound),
    ])

    const author = object[AUTHOR]
    if (prev) {
      if (prev[OWNER]) {
        // OWNER may change to an array of strings in the future
        if (![].concat(prev[OWNER]).includes(author)) {
          throw new Errors.InvalidAuthor(`expected ${prev[OWNER]} as specified in the prev verison's ${OWNER} property, got ${author}`)
        }
      } else if (prev[AUTHOR] !== author) {
        this.logger.warn(`object ${buildResource.permalink(object)} author changed from ${prev[AUTHOR]} to ${author} in version ${buildResource.link(object)}`)
      }
    } else {
      this.logger.warn(`don't have prev version ${object[PREVLINK]} of object ${link}`)
    }

    try {
      protocol.validateVersioning({
        object,
        prev,
        orig: orig || object[PERMALINK]
      })
    } catch (err) {
      Errors.rethrowAs(err, new Errors.InvalidVersion(err.message))
    }
  }

  // private isAuthoredByMe = async (object:ITradleObject) => {
  //   const promiseMyPermalink = this.identity.getPermalink()
  //   let { _author } = object
  //   if (!_author) {
  //     ({ _author } = await this.identities.getAuthorInfo(object))
  //   }

  //   const myPermalink = await promiseMyPermalink
  //   return _author === myPermalink
  // }
}

export { Messaging }

const getIntroducedIdentity = (payload) => {
  const type = payload[TYPE]
  if (type === IDENTITY) return payload

  if (type === SELF_INTRODUCTION || type === INTRODUCTION || type === IDENTITY_PUBLISH_REQUEST) {
    return payload.identity
  }
}

const normalizeBuffer = (buf):Buffer => {
  if (Buffer.isBuffer(buf)) return buf

  if (!Array.isArray(buf.data)) throw new Errors.InvalidInput('expected buffer')

  return Buffer.from(buf.data)
}
