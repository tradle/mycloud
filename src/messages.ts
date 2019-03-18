import _ from 'lodash'
import { TYPE, SIG } from '@tradle/constants'
import { FindOpts } from '@tradle/dynamodb'
import { utils as tradleUtils } from '@tradle/engine'
import { ITradleMessage, IECMiniPubKey, Env, Identities, Objects, Logger, DB } from './types'

import Errors from './errors'
import { typeforce, pickVirtual, setVirtual, logify } from './utils'
import { getLink } from './crypto'
import * as types from './typeforce-types'
import { TYPES, SEQ, PREV_TO_RECIPIENT, TIMESTAMP } from './constants'

const { MESSAGE } = TYPES

import baseModels from './models'

const ObjectModel = baseModels['tradle.Object']
const MessageModel = baseModels[MESSAGE]
const MESSAGE_PROPS = _.uniq(
  Object.keys(MessageModel.properties).concat(Object.keys(ObjectModel.properties))
)

const MESSAGE_PROPS_MINUS_PAYLOAD = MESSAGE_PROPS.slice().filter(p => p !== 'object')
const getSelect = (body?: boolean) => (body ? MESSAGE_PROPS : MESSAGE_PROPS_MINUS_PAYLOAD)

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

// const proxyNotFound = err => {
//   if (Errors.matches(err, { name: 'NotFound' })) {
//     throw new Errors.NotFound(err.message)
//   }
// }

interface IMessageStub {
  time: number
  link: string
}

interface ISeqAndLink {
  seq: number
  link: string
}

type MessagesOpts = {
  env: Env
  identities: Identities
  objects: Objects
  logger: Logger
  db: DB
}

export default class Messages {
  constructor(private components: MessagesOpts) {
    logify(
      this,
      {
        logger: components.logger,
        level: 'silly'
      },
      ['getMessagesTo', 'getLastMessageFrom', 'getLastSeqAndLink']
    )
  }

  // lazy load
  get logger() {
    return this.components.logger
  }

  get identities() {
    return this.components.identities
  }

  get objects() {
    return this.components.objects
  }

  get env() {
    return this.components.env
  }

  get db() {
    return this.components.db
  }

  public validateInbound = validateInbound

  public getPropsDerivedFromLast = last => {
    const seq = last ? last.seq + 1 : 0
    const props = { [SEQ]: seq }
    if (last) {
      props[PREV_TO_RECIPIENT] = last.link
    }

    return props
  }

  public formatForDB = (message: ITradleMessage) => {
    return this.stripData(message)
  }

  public formatForDelivery = _.identity

  public serializePubKey = (key: IECMiniPubKey): string => {
    if (typeof key === 'string') return key

    return `${key.curve}:${key.pub.toString('hex')}`
  }

  public unserializePubKey = (key: string): IECMiniPubKey => {
    if (typeof key !== 'string') return key

    const [curve, pub] = key.split(':')
    return {
      curve,
      pub: new Buffer(pub, 'hex')
    }
  }

  public getMessageStub = (opts: { message: ITradleMessage; error?: any }): IMessageStub => {
    const { message, error } = opts
    const stub = {
      link: (error && error.link) || getLink(message),
      time: message[TIMESTAMP]
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

  public save = async (message: ITradleMessage) => {
    const _counterparty = message._inbound ? message._author : message._recipient
    setVirtual(message, {
      // make sure _inbound is set
      _inbound: !!message._inbound,
      _payloadType: message.object[TYPE],
      _payloadLink: message.object._link,
      _payloadAuthor: message.object._author,
      _counterparty,
      _dcounterparty: this.getDCounterpartyKey({ _counterparty, _inbound: message._inbound })
      // _seqToRecipient: `${message._recipient}:${message[SEQ]}`
    })

    // const promiseSavePayload = this.savePayloadToDB(message)
    const item = this.formatForDB(message)
    if (message._inbound) {
      await this.putInboundMessage({ message, item })
    } else {
      await this.putOutboundMessage({ message, item })
    }

    // await Promise.all([
    //   promiseSaveEnvelope,
    //   promiseSavePayload
    // ])
  }

  public putOutboundMessage = async (opts: { message: ITradleMessage; item }): Promise<void> => {
    await this.db.put(opts.item)
  }

  public putInboundMessage = async (opts: { message: ITradleMessage; item }): Promise<void> => {
    const { item, message } = opts
    try {
      await this.db.put(item, {
        ConditionExpression: 'attribute_not_exists(#time)',
        ExpressionAttributeNames: {
          '#time': TIMESTAMP
        }
        // expected: { time: { Exists: false }  }
      })
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        Errors.rethrowAs(err, new Errors.Duplicate('duplicate inbound message', getLink(message)))
      }

      throw err
    }
  }

  public loadMessage = async (message: ITradleMessage): Promise<ITradleMessage> => {
    const body = await this.objects.get(getLink(message.object))
    message.object = _.extend(message.object || {}, body)
    return message
  }

  public getLastMessageFrom = async ({
    author,
    body
  }: {
    author: string
    body: boolean
  }): Promise<ITradleMessage> => {
    const opts = getBaseFindOpts({
      select: getSelect(body),
      match: {
        _counterparty: author,
        _inbound: true
      },
      // don't omit "limit"
      limit: 1,
      orderBy: TIMESTAMP,
      reverse: true
    })

    return await this.db.findOne(opts)
  }

  public getLastSeqAndLink = async ({
    recipient
  }: {
    recipient: string
  }): Promise<ISeqAndLink | null> => {
    this.logger.debug(`looking up last message to ${recipient}`)

    const opts = getBaseFindOpts({
      match: {
        _counterparty: recipient,
        _inbound: false
      },
      orderBy: TIMESTAMP,
      reverse: true,
      select: [SEQ, '_link'],
      // don't omit "limit"
      limit: 1
    })

    let last
    try {
      last = await this.db.findOne(opts)
      const pos = {
        seq: last[SEQ],
        link: last._link
      }

      this.logger.debug('last message', pos)
      return pos
    } catch (err) {
      if (Errors.isNotFound(err)) {
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

  public getMessagesTo = async ({
    recipient,
    gt = 0,
    limit,
    body = true
  }: {
    recipient: string
    gt?: number
    limit?: number
    body?: boolean
  }): Promise<ITradleMessage[]> => {
    const opts = getBaseFindOpts({
      limit,
      match: {
        _counterparty: recipient,
        _inbound: false
      },
      orderBy: TIMESTAMP,
      select: getSelect(body)
    })

    opts.filter.GT = {
      [TIMESTAMP]: gt
    }

    const { items } = await this.db.find(opts)
    const messages = items.map(this.formatForDelivery)
    return body ? Promise.all(messages.map(this.loadMessage)) : messages
  }

  public getLastMessageTo = async ({
    recipient,
    body = true
  }: {
    recipient: string
    body?: boolean
  }): Promise<ITradleMessage> => {
    const opts: any = getBaseFindOpts({
      match: {
        _counterparty: recipient,
        _inbound: false
      },
      // don't omit "limit"
      limit: 1,
      orderBy: TIMESTAMP,
      reverse: true,
      select: getSelect(body)
    })

    return await this.db.findOne(opts)
  }

  public getLastMessageByContext = async ({
    inbound,
    context
  }: {
    context: string
    inbound: boolean
  }) => {
    return this.getMessagesByContext({ inbound, context, limit: 1, reverse: true })
  }

  public getMessagesByContext = async ({
    inbound,
    context,
    limit,
    reverse = true
  }: {
    context: string
    inbound: boolean
    limit: number
    reverse?: boolean
  }) => {
    const filter: any = {
      EQ: {
        [TYPE]: MESSAGE,
        context
      }
    }

    const opts: FindOpts = {
      limit,
      filter,
      orderBy: {
        property: TIMESTAMP,
        desc: reverse
      }
    }

    if (typeof inbound === 'boolean') {
      filter.EQ._inbound = inbound
    } else {
      // we're not filtering, so no need to fetch in bigger batches
      opts.batchLimit = limit
    }

    const { items } = await this.db.find(opts)
    return items
  }

  // public getInboundByLink = async (link:string) => {
  //   return await this.db.findOne({
  //     filter: {
  //       EQ: {
  //         _link: link
  //       }
  //     }
  //   })
  // }

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

  public assertTimestampIncreased = async message => {
    const link = getLink(message)
    const time = message[TIMESTAMP] || 0
    try {
      const prev = await this.getLastMessageFrom({
        author: message._author,
        body: false
      })

      if (prev._link === link) {
        throw new Errors.Duplicate('duplicate inbound message', link)
      }

      if (prev[TIMESTAMP] >= time) {
        const msg = `TimeTravel: timestamp for message ${link} is <= the previous messages's (${
          prev._link
        })`
        this.logger.debug(msg)
        throw new Errors.TimeTravel(msg, link)
      }
    } catch (err) {
      Errors.ignoreNotFound(err)
    }
  }

  public getMessagePayload = async ({ bot, message }) => {
    if (message.object[SIG]) {
      return message.object
    }

    return await this.objects.get(getLink(message.object))
  }

  public static getDCounterpartyKey = ({
    _counterparty,
    _inbound
  }: {
    _counterparty: string
    _inbound?: boolean
  }) => {
    const dir = _inbound ? 'i' : 'o'
    return `${dir}:${_counterparty}`
  }

  public getDCounterpartyKey = Messages.getDCounterpartyKey

  // private assertNoDrift = (message) => {
  //   const drift = message[TIMESTAMP] - Date.now()
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

const validateInbound = message => {
  try {
    typeforce(types.message, message)
  } catch (err) {
    Errors.rethrowAs(err, new Errors.InvalidMessageFormat(err.message))
  }
}

const getBaseFindOpts = ({
  match = {},
  limit,
  orderBy,
  reverse,
  select
}: {
  match?: Partial<ITradleMessage>
  limit?: number
  orderBy?: string
  reverse?: boolean
  select?: string[]
}): FindOpts => {
  const { _counterparty, _inbound } = match
  if (_counterparty) {
    match._dcounterparty = Messages.getDCounterpartyKey({ _counterparty, _inbound })
    delete match._counterparty
    delete match._inbound
  }

  const opts: any = {
    limit,
    filter: {
      EQ: {
        [TYPE]: MESSAGE,
        ...match
      }
    }
  }

  if (orderBy) {
    opts.orderBy = {
      property: orderBy,
      desc: !!reverse
    }
  }

  if (select) {
    opts.select = select
  }

  // we're not filtering, so no need to fetch in bigger batches
  if (limit) opts.batchLimit = limit

  return opts
}
