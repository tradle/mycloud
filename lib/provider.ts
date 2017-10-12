import Debug from 'debug'
const debug = Debug('tradle:sls:provider')
import { utils } from '@tradle/engine'
import { sign, getSigningKey, getChainKey, getPermalink } from './crypto'
import {
  cachifyPromiser,
  extend,
  clone,
  setVirtual,
  pickVirtual,
  typeforce
} from './utils'

import * as Errors from './errors'
import * as types from './typeforce-types'
import {
  IDENTITY_KEYS_KEY,
  SEQ,
  TYPE,
  TYPES,
  SIG,
  PUBLIC_CONF_BUCKET
} from './constants'

import { ISession } from './types'

const { MESSAGE } = TYPES

export default class Provider {
  private tradle: any
  private objects: any
  private messages: any
  private secrets: any
  private identities: any
  private buckets: any
  private auth: any
  private network: any
  constructor (tradle) {
    this.tradle = tradle
    this.objects = tradle.objects
    this.messages = tradle.messages
    this.secrets = tradle.secrets
    this.identities = tradle.identities
    this.buckets = tradle.buckets
    this.auth = tradle.auth
    this.network = tradle.network
  }

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

  public getMyChainKeyPub = async () => {
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

  public signObject = async ({ author, object }) => {
    if (!author) author = await this.getMyPrivateIdentity()

    const key = getSigningKey(author.keys)
    const signed = await sign({ key, object })

    this.objects.addMetadata(signed)
    setVirtual(signed, { _author: getPermalink(author.identity) })
    return signed
  }

  public findOrCreate = async ({ link, object, author }) => {
    if (!object) {
      return this.objects.getObjectByLink(link)
    }

    if (!object[SIG]) {
      object = await this.signObject({ author, object })
    }

    await this.objects.putObject(object)
    this.objects.addMetadata(object)
    return object
  }

  public createSendMessageEvent = async (opts) => {
    if (!opts.time) {
      opts.time = Date.now()
    }

    if (!opts.author) {
      opts.author = await this.getMyPrivateIdentity()
    }

    return this._createSendMessageEvent(opts)
  }

  public receiveMessage = async ({ message }) => {
    // can probably move this to lamdba
    // as it's normalizing transport-mangled inputs
    try {
      message = this.messages.normalizeInbound(message)
      message = await this.messages.preProcessInbound(message)
    } catch (err) {
      err.progress = message
      debug('unexpected error in pre-processing inbound message:', err.stack)
      throw err
    }

    try {
      return await this.createReceiveMessageEvent({ message })
    } catch (err) {
      err.progress = message
      throw err
    }
  }

  public createReceiveMessageEvent = async ({ message }) => {
    message = await this.messages.parseInbound(message)
    // TODO: phase this out
    await this.objects.putObject(message.object)

    // if (objectWrapper.type === IDENTITY && messageWrapper.sigPubKey === objectWrapper.sigPubKey) {
    //   // special case: someone is sending us their own identity

    //   // TODO: validate identity
    //   // await getIdentityByPubKey(objectWrapper.sigPubKey)

    //   const { link, permalink, sigPubKey } = objectWrapper
    //   await Events.putEvent({
    //     topic: 'addcontact',
    //     link,
    //     permalink,
    //     sigPubKey
    //   })
    // }

    await this.messages.putMessage(message)
    return message
  }

  // const ensureMessageIsForMe = co(function* ({ message }) {
  //   const toPubKey = message.recipientPubKey.pub.toString('hex')
  //   const recipient = await getMyPublicIdentity()
  //   const myPubKey = recipient.object.pubkeys.find(pubKey => {
  //     return pubKey.pub === toPubKey
  //   })

  //   if (!myPubKey) {
  //     debug(`ignoring message meant for someone else (with pubKey: ${toPubKey}) `)
  //     throw new Errors.MessageNotForMe(`message to pub key: ${toPubKey}`)
  //   }
  // })

  public sendMessage = async (opts: { recipient: string, object: any, other?: any }) => {
    const { recipient, object, other={} } = opts
    // start this first to get a more accurate timestamp
    const promiseCreate = this.createSendMessageEvent({ recipient, object, other })
    const promiseSession = this.auth.getLiveSessionByPermalink(recipient)

    // should probably do this asynchronously
    let session
    try {
      session = await promiseSession
    } catch (err) {
      debug(`mqtt session not found for ${recipient}`)
    }

    const message = await promiseCreate
    try {
      await this.attemptLiveDelivery({ recipient, message, session })
    } catch (err) {
      if (err instanceof Errors.NotFound) {
        debug('live delivery canceled', err.stack)
      } else {
        // rethrow, as this is likely a developer error
        debug('live delivery failed', err)
        throw err
      }
    }

    return message
  }

  public attemptLiveDelivery = async (opts: {
    message: any,
    recipient: string,
    session?: ISession
  }) => {
    const { message, recipient, session } = opts
    debug(`sending message (time=${message.time}) to ${recipient} live`)
    await this.tradle.delivery.deliverBatch({
      clientId: session && session.clientId,
      recipient,
      messages: [message]
    })
  }

  public lookupMyIdentity = ():Promise<any> => {
    return this.secrets.get(IDENTITY_KEYS_KEY)
  }

  public lookupMyPublicIdentity = ():Promise<any> => {
    return this.buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.identity)
  }

  public getMyPrivateIdentity = cachifyPromiser(this.lookupMyIdentity)

  public getMyPublicIdentity = cachifyPromiser(this.lookupMyPublicIdentity)

  private _createSendMessageEvent = async (opts) => {
    const { author, recipient, link, object, other={} } = opts

    typeforce({
      recipient: types.link,
      object: typeforce.maybe(typeforce.Object),
      other: typeforce.maybe(typeforce.Object),
    }, opts)

    // run in parallel
    const promisePayload = this.findOrCreate({ link, object, author })
    const promisePrev = this.messages.getLastSeqAndLink({ recipient })
    const promiseRecipient = this.identities.getIdentityByPermalink(recipient)
    const [payload, recipientObj] = await Promise.all([
      promisePayload,
      promiseRecipient
    ])

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
      debug(`signing message ${seq} to ${recipient}`)

      signedMessage = await this.signObject({ author, object: unsignedMessage })
      setVirtual(signedMessage, {
        _author: getPermalink(author.identity),
        _recipient: getPermalink(recipientObj)
      })

      setVirtual(signedMessage.object, payloadVirtual)

      try {
        await this.messages.putMessage(signedMessage)
        return signedMessage
      } catch (err) {
        if (err.code !== 'ConditionalCheckFailedException') {
          throw err
        }

        debug(`seq ${seq} was taken by another message`)
        prev = await this.messages.getLastSeqAndLink({ recipient })
        debug(`retrying with seq ${seq}`)
      }
    }

    const err = new Errors.PutFailed('failing after 3 retries')
    err.retryable = true
    throw err
  }
}
