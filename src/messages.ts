import _ = require('lodash')
import AWS = require('aws-sdk')
import { TYPE, SIG } from '@tradle/constants'
import { utils as tradleUtils } from '@tradle/engine'
import { DB } from '@tradle/dynamodb'
import Identities from './identities'
import Objects from './objects'
import Env from './env'
import { IDebug, ITradleMessage, ITradleObject, IECMiniPubKey } from './types'
import Errors = require('./errors')
import {
  typeforce,
  pickVirtual,
  setVirtual,
  bindAll,
  RESOLVED_PROMISE
} from './utils'
import { getLink } from './crypto'
import { prettify } from './string-utils'
import * as types from './typeforce-types'
import Logger from './logger'
import { Tradle } from './tradle'
import {
  TYPES,
  MAX_CLOCK_DRIFT,
  SEQ,
  PREV_TO_RECIPIENT,
  PREVLINK,
  DB_IGNORE_PAYLOAD_TYPES
} from './constants'

const unserializeMessage = message => {
  if (Buffer.isBuffer(message)) {
    try {
      return JSON.parse(message.toString())
    } catch (e) {
      try {
        return tradleUtils.unserializeMessage(message)
      } catch (err) {
        this.logger.error('unable to unserialize message', { message, error: err.stack })
        throw err
      }
    }
  }

  return message
}

const {
  MESSAGE,
} = TYPES

interface IMessageStub {
  time: number
  link: string
}

interface ISeqAndLink {
  seq: number
  link: string
}

export default class Messages {
  private env: Env
  private logger: Logger
  private identities: Identities
  private objects: Objects
  private tables: any
  private tradle: Tradle
  public inbox: any
  public outbox: any

  constructor (tradle: Tradle) {
    const { env, identities, objects, tables, logger } = tradle
    this.tradle = tradle
    this.env = env
    this.logger = logger.sub('messages')
    this.identities = identities
    this.objects = objects
    this.tables = tables
    this.outbox = tables.Outbox
    this.inbox = tables.Inbox
  }

  get db() {
    return this.tradle.db
  }

  public normalizeInbound = (message:any):ITradleMessage => {
    const { recipientPubKey } = message
    if (!recipientPubKey) {
      throw new Errors.InvalidMessageFormat('unexpected format')
    }

    const { pub } = recipientPubKey
    if (!Buffer.isBuffer(pub)) {
      recipientPubKey.pub = new Buffer(pub.data)
    }

    validateInbound(message)
    return message
  }

  public getPropsDerivedFromLast = (last) => {
    const seq = last ? last.seq + 1 : 0
    const props = { [SEQ]: seq }
    if (last) {
      props[PREV_TO_RECIPIENT] = last.link
    }

    return props
  }

  public formatForDB = (message: ITradleMessage) => {
    const neutered = this.stripData(message)
    return {
      ...neutered,
      recipientPubKey: this.serializePubKey(message.recipientPubKey)
    }
  }

  public messageFromEventPayload = (event):ITradleMessage => {
    return {
      ...event,
      recipientPubKey: this.unserializePubKey(event.recipientPubKey)
    }
  }

  public serializePubKey = (key:IECMiniPubKey):string => {
    return `${key.curve}:${key.pub.toString('hex')}`
  }

  public unserializePubKey = (key:string):IECMiniPubKey => {
    const [curve, pub] = key.split(':')
    return {
      curve,
      pub: new Buffer(pub, 'hex')
    }
  }

  public getMessageStub = (opts: {
    message: ITradleMessage,
    error?: ErrorConstructor
  }):IMessageStub => {
    const { message, error } = opts
    const stub = {
      link: (error && error.link) || getLink(message),
      time: message.time
    }

    typeforce(types.messageStub, stub)
    return stub
  }

  public stripData = (message: ITradleMessage) => {
    return {
      ...message,
      object: pickVirtual(message.object)
    }
  }

  public putMessage = async (message: ITradleMessage) => {
    setVirtual(message, {
      _payloadType: message.object[TYPE],
      _payloadLink: message.object._link,
      _payloadAuthor: message.object._author,
      // _seqToRecipient: `${message._recipient}:${message[SEQ]}`
    })

    const promiseSavePayload = this.savePayloadToDB(message)
    const item = this.formatForDB(message)
    const promiseSaveEnvelope = message._inbound
      ? this.putInboundMessage({ message, item })
      : this.putOutboundMessage({ message, item })

    await Promise.all([
      promiseSaveEnvelope,
      promiseSavePayload
    ])
  }

  public putOutboundMessage = async (opts: {
    message: ITradleMessage,
    item
  }):Promise<void> => {
    const { item } = opts
    await this.outbox.put({
      Item: item,
      // ConditionExpression: 'attribute_not_exists(#seqToRecipient)',
      // ExpressionAttributeNames: {
      //   '#seqToRecipient': '_seqToRecipient'
      // }
    })
  }

  public putInboundMessage = async (opts: {
    message: ITradleMessage,
    item
  }):Promise<void> => {
    const { item, message } = opts
    const params = {
      Item: item,
      ConditionExpression: 'attribute_not_exists(#link)',
      ExpressionAttributeNames: {
        '#link': '_link'
      }
    }

    try {
      await this.inbox.put(params)
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        throw new Errors.Duplicate('duplicate inbound message', getLink(message))
      }

      throw err
    }
  }

  public loadMessage = async (message: ITradleMessage):Promise<ITradleMessage> => {
    const body = await this.objects.get(getLink(message.object))
    message.object = _.extend(message.object || {}, body)
    return message
  }

  public getMessageFrom = async (opts: {
    author: string,
    time: number,
    link?: string,
    body?:boolean
  }):Promise<ITradleMessage> => {
    const { author, time, link, body=true } = opts
    if (body && link) {
      // prime cache
      this.objects.prefetch(link)
    }

    return await this.maybeAddBody({
      message: await this.get(this.inbox, {
        _author: author,
        time
      }),
      body
    })
  }

  public getMessagesFrom = async (opts: {
    author: string,
    gt: number,
    limit: number,
    body: boolean
  }):Promise<ITradleMessage[]> => {
    const { author, gt, limit, body=true } = opts
    this.logger.debug(`looking up inbound messages from ${author}, > ${gt}`)
    const params = this.getMessagesFromQuery({ author, gt, limit })
    const messages = await this.find(this.inbox, params)
    return body ? Promise.all(messages.map(this.loadMessage)) : messages
  }

  public getLastMessageFrom = async (opts: {
    author: string,
    body: boolean
  }):Promise<ITradleMessage> => {
    const { author, body=true } = opts
    const params = this.getLastMessageFromQuery({ author })
    return this.maybeAddBody({
      message: await this.findOne(this.inbox, params),
      body
    })
  }

  public maybeAddBody = async (opts: {
    message:any,
    body: boolean
  }):Promise<ITradleMessage> => {
    const { message, body } = opts
    return body ? this.loadMessage(message) : message
  }

  public getLastSeqAndLink = async (opts: { recipient: string }):Promise<ISeqAndLink|null> => {
    const { recipient } = opts
    this.logger.debug(`looking up last message to ${recipient}`)

    const query = this.getLastMessageToQuery({ recipient })
    query.ExpressionAttributeNames!['#link'] = '_link'
    query.ExpressionAttributeNames![`#${SEQ}`] = SEQ
    query.ProjectionExpression = `#${SEQ}, #link`

    let last
    try {
      last = await this.outbox.findOne(query)
      this.logger.debug('last message', last)
      return {
        seq: last[SEQ],
        link: last._link
      }
    } catch (err) {
      if (err instanceof Errors.NotFound) {
        return null
      }

      this.logger.error('experienced error in getLastSeqAndLink', { error: err.stack })
      throw err
    }
  }

  // const getNextSeq = co(function* ({ recipient }) {
  //   const last = await getLastSeq({ recipient })
  //   return last + 1
  // })

  public getMessagesTo = async (opts: {
    recipient: string,
    gt?: number,
    afterMessage?: any,
    limit?:number,
    body?:boolean
  }):Promise<ITradleMessage[]> => {
    const { recipient, gt=0, afterMessage, limit, body=true } = opts
    if (afterMessage) {
      this.logger.debug(`looking up outbound messages for ${recipient}, after ${afterMessage}`)
    } else {
      this.logger.debug(`looking up outbound messages for ${recipient}, time > ${gt}`)
    }

    const params = this.getMessagesToQuery({ recipient, gt, afterMessage, limit })
    const messages = await this.find(this.outbox, params)
    return body ? Promise.all(messages.map(this.loadMessage)) : messages
  }

  public getLastMessageTo = async (opts: {
    recipient: string,
    body: boolean
  }):Promise<ITradleMessage> => {
    const { recipient, body=true } = opts
    const params = this.getLastMessageToQuery({ recipient })
    return this.maybeAddBody({
      message: await this.findOne(this.outbox, params),
      body
    })
  }

  public getLastMessageByContext = async ({ inbound, context } : {
    context: string
    inbound: boolean
  }) => {
    return this.getMessagesByContext({ inbound, context, limit: 1, reverse: true })
  }

  public getMessagesByContext = async ({ inbound, context, limit, reverse=true } : {
    context: string
    inbound: boolean
    limit: number
    reverse?: boolean
  }) => {
    const box = inbound ? this.inbox : this.outbox
    return await box.find({
      IndexName: 'context',
      KeyConditionExpression: '#context = :context',
      ExpressionAttributeNames: {
        '#context': 'context'
      },
      ExpressionAttributeValues: {
        ':context': context
      },
      ScanIndexForward: !reverse,
      Limit: limit
    })
  }

  public getInboundByLink = async (link:string) => {
    return await this.findOne(this.inbox, {
      IndexName: '_link',
      KeyConditionExpression: '#link = :link',
      ExpressionAttributeNames: {
        '#link': '_link'
      },
      ExpressionAttributeValues: {
        ':link': link
      },
      ScanIndexForward: true,
      Limit: 1
    })
  }

  // const assertNotDuplicate = co(function* (link) {
  //   try {
  //     const duplicate = await this.getInboundByLink(link)
  //     this.debug(`duplicate found for message ${link}`)
  //     const dErr = new Errors.Duplicate()
  //     dErr.link = link
  //     throw dErr
  //   } catch (err) {
  //     if (!(err instanceof Errors.NotFound)) {
  //       throw err
  //     }
  //   }
  // })

  public assertTimestampIncreased = async (message) => {
    const link = getLink(message)
    const { time=0 } = message
    try {
      const prev = await this.getLastMessageFrom({
        author: message._author,
        body: false
      })

      if (prev._link === link) {
        throw new Errors.Duplicate('duplicate inbound message', link)
      }

      if (prev.time >= time) {
        const msg = `TimeTravel: timestamp for message ${link} is <= the previous messages's (${prev._link})`
        this.logger.debug(msg)
        throw new Errors.TimeTravel(msg, link)
      }
    } catch (err) {
      if (!(err instanceof Errors.NotFound)) {
        throw err
      }
    }
  }

  public processInbound = async (message: ITradleMessage):Promise<ITradleMessage> => {
    // TODO: uncomment below, check that message is for us
    // await ensureMessageIsForMe({ message })
    const min = message
    // const payload = message.object

    // prereq to running validation
    await this.objects.resolveEmbeds(message)

    this.objects.addMetadata(message)
    this.objects.addMetadata(message.object)

    setVirtual(min, pickVirtual(message))
    setVirtual(min.object, pickVirtual(message.object))
    message = min
    const payload = message.object

    // TODO:
    // would be nice to parallelize some of these
    // await assertNotDuplicate(messageWrapper.link)

    if (payload[PREVLINK]) {
      // prime cache
      this.objects.prefetch(payload[PREVLINK])
    }

    const addMessageAuthor = this.identities.addAuthorInfo(message)
    let addPayloadAuthor
    if (payload._sigPubKey === message._sigPubKey) {
      addPayloadAuthor = addMessageAuthor.then(() => {
        setVirtual(payload, { _author: message._author })
      })
    } else {
      addPayloadAuthor = this.identities.addAuthorInfo(payload)
    }

    await Promise.all([
      addMessageAuthor
        .then(() => this.logger.debug('loaded message author')),
      addPayloadAuthor
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
      await this.assertTimestampIncreased(message)
    }

    setVirtual(message, {
      _inbound: true
    })

    return message
  }

  public getMessagePayload = async ({ bot, message }) => {
    if (message.object[SIG]) {
      return message.object
    }

    return await this.objects.get(getLink(message.object))
  }

  public savePayloadToDB = async (message: ITradleMessage):Promise<boolean> => {
    const type = message.object[TYPE]
    const ignored = message._inbound
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

    await this.db.put(message.object)
    return true
  }

  private get = async (table, Key):Promise<ITradleMessage> => {
    const event = await table.get({ Key })
    return this.messageFromEventPayload(event)
  }

  private findOne = async (table, params):Promise<ITradleMessage> => {
    const event = await table.findOne(params)
    return this.messageFromEventPayload(event)
  }

  private find = async (table, params):Promise<ITradleMessage[]> => {
    const events = await table.find(params)
    return events.map(this.messageFromEventPayload)
  }

  private getMessagesFromQuery = ({
    author,
    gt,
    limit
  }):AWS.DynamoDB.DocumentClient.QueryInput => {
    const params:AWS.DynamoDB.DocumentClient.QueryInput = {
      TableName: this.inbox.name,
      KeyConditionExpression: '#author = :author AND #time > :time',
      ExpressionAttributeNames: {
        '#author': '_author',
        '#time': 'time'
      },
      ExpressionAttributeValues: {
        ':author': author,
        ':time': gt
      },
      ScanIndexForward: true
    }

    if (limit) {
      params.Limit = limit
    }

    return params
  }

  private getLastMessageFromQuery = (opts: {
    author: string
  }):AWS.DynamoDB.DocumentClient.QueryInput => {
    const { author } = opts
    return {
      TableName: this.inbox.name,
      KeyConditionExpression: '#author = :author AND #time > :time',
      ExpressionAttributeNames: {
        '#author': '_author',
        '#time': 'time'
      },
      ExpressionAttributeValues: {
        ':author': author,
        ':time': 0
      },
      ScanIndexForward: false,
      Limit: 1
    }
  }

  private getMessagesToQuery = (opts: {
    recipient: string,
    gt?: number,
    afterMessage?: any,
    limit?: number
  }):AWS.DynamoDB.DocumentClient.QueryInput => {
    const { recipient, gt, afterMessage, limit } = opts
    const params:AWS.DynamoDB.DocumentClient.QueryInput = {
      TableName: this.outbox.name,
      KeyConditionExpression: `#recipient = :recipient AND #time > :time`,
      ExpressionAttributeNames: {
        '#recipient': '_recipient',
        '#time': 'time'
      },
      ExpressionAttributeValues: {
        ':recipient': recipient,
        ':time': gt
      },
      ScanIndexForward: true
    }

    if (afterMessage) {
      params.ExclusiveStartKey = afterMessage
    }

    if (limit) {
      params.Limit = limit
    }

    return params
  }

  private getLastMessageToQuery = (opts: {
    recipient: string
  }):AWS.DynamoDB.DocumentClient.QueryInput => {
    const { recipient } = opts
    return {
      TableName: this.outbox.name,
      KeyConditionExpression: `#recipient = :recipient AND #time > :time`,
      ExpressionAttributeNames: {
        '#recipient': '_recipient',
        '#time': 'time'
      },
      ExpressionAttributeValues: {
        ':recipient': recipient,
        ':time': 0
      },
      ScanIndexForward: false,
      Limit: 1
    }
  }
// private assertNoDrift = (message) => {
//   const drift = message.time - Date.now()
//   const side = drift > 0 ? 'ahead' : 'behind'
//   if (Math.abs(drift) > MAX_CLOCK_DRIFT) {
//     this.debug(`message is more than ${MAX_CLOCK_DRIFT}ms ${side} server clock`)
//     throw new Errors.ClockDrift(`message is more than ${MAX_CLOCK_DRIFT}ms ${side} server clock`)
//   }
// }

}

export { Messages }

// private static methods


// for this to work, need a Global Secondary Index on `time`
//
// const getInboundByTimestamp = co(function* ({ gt }) {
//   this.debug(`looking up inbound messages with time > ${gt}`)
//   const time = gt
//   const KeyConditionExpression = `time > :time`

//   const params = {
//     IndexName: 'time',
//     KeyConditionExpression,
//     ExpressionAttributeValues: {
//       ':gt': time,
//     },
//     ScanIndexForward: true
//   }

//   const messages = await Tables.Inbox.find(params)
//   return await Promise.all(messages.map(loadMessage))
// })

const validateInbound = (message) => {
  try {
    typeforce(types.message, message)
  } catch (err) {
    throw new Errors.InvalidMessageFormat(err.message)
  }
}
