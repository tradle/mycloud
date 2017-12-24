import { omit, cloneDeep } from 'lodash'
import mergeSorted = require('merge-sorted')
import { Table, createTable, utils, constants } from '@tradle/dynamodb'

const { getQueryInfo } = utils
const definitions = require('./definitions')

type InAndOut = {
  inbound?: any
  outbound?: any
}

export function createMessagesTable ({ models, getMyIdentity }: {
  models:any,
  getMyIdentity:() => Promise<any>
}):Table {
  const model = models['tradle.Message']
  const inbox = createTable({
    models,
    model,
    exclusive: true,
    forbidScan: true,
    readOnly: true,
    tableDefinition: utils.toDynogelTableDefinition(definitions.InboxTable.Properties)
  })

  const outbox = createTable({
    models,
    model,
    exclusive: true,
    forbidScan: true,
    readOnly: true,
    tableDefinition: utils.toDynogelTableDefinition(definitions.OutboxTable.Properties)
  })

  const getBoxFromFilter = query => {
    const { filter={} } = query
    const { EQ={} } = filter
    if (typeof EQ._inbound === 'boolean') {
      return EQ._inbound ? inbox : outbox
    }

    // throw new Error('expected "_inbound" property in "EQ"')
  }

  const sanitizeQuery = (query) => {
    query = cloneDeep(query)
    delete query.filter.EQ._inbound
    return query
  }

  const execQuery = async (method:string, query:any) => {
    const box = getBoxFromFilter(query)
    if (box) {
      return box[method](sanitizeQuery(query))
    }

    // only allow queries for messages
    // paged in reverse time order

    let {
      checkpoint,
      filter={},
      orderBy={},
      limit=50
    } = query

    if (orderBy.property !== 'time') {
      throw new Error('expected orderBy "time"')
    }

    let { IN={}, EQ={}, GT={}, LT={} } = filter
    if (!orderBy.desc) {
      if (!(checkpoint || GT.time || LT.time)) {
        throw new Error('expected GT.time and/or LT.time')
      }
    }

    // if (!(orderBy.property === 'time' && orderBy.desc)) {
    //   throw new Error('expected "orderBy" time descending')
    // }

    let counterparty = EQ._counterparty
    if (!counterparty) {
      const { _author, _recipient } = IN
      if (!(_author && _recipient)) {
        throw new Error('expected IN._author and IN._recipient')
      }

      if (!equalsIgnoreOrder(_author, _recipient)) {
        throw new Error('expected IN._author and IN._recipient to be the same')
      }

      const identity = await getMyIdentity()
      if (!_author.includes(identity._permalink)) {
        throw new Error(`expected one of the parties to be this bot: "${identity._permalink}"`)
      }

      counterparty = _author.find(permalink => permalink !== identity._permalink)
    }

    IN = omit(IN, ['_author', '_recipient'])
    EQ = omit(EQ, ['_counterparty'])
    const inboundFilter = {
      ...filter,
      IN,
      EQ: {
        ...EQ,
        _author: counterparty
      }
    }

    const outboundFilter = {
      ...filter,
      IN,
      EQ: {
        ...EQ,
        _recipient: counterparty
      }
    }

    filter.EQ = EQ
    filter.IN = IN
    const [
      inbound,
      outbound
    ] = await Promise.all([
      inbox[method]({
        ...query,
        filter: inboundFilter,
        checkpoint: checkpoint && checkpoint.inbound,
        limit
      }),
      outbox[method]({
        ...query,
        filter: outboundFilter,
        checkpoint: checkpoint && checkpoint.outbound,
        limit
      })
    ])

    const merged = mergeInboundOutbound({
      inbound,
      outbound,
      filter,
      orderBy,
      limit
    })

    return merged
  }

  const mergeInboundOutbound = ({
    inbound,
    outbound,
    filter,
    orderBy,
    limit
  }) => {

    let merged:any[] = []
    const i = inbound.items.slice()
    const o = outbound.items.slice()
    const compare = (a, b) => utils.compare(a, b, orderBy.property, !orderBy.desc)
    let lastI
    let lastO
    while (i.length && o.length && merged.length < limit) {
      while (compare(i[0], o[0]) < 0) {
        lastI = i[0]
        merged.push(i.shift())
        if (merged.length === limit) break
      }

      if (merged.length === limit) break

      lastO = o[0]
      merged.push(o.shift())
    }

    if (merged.length < limit) {
      if (i.length) {
        merged = merged.concat(i.slice(0, limit - merged.length))
        lastI = merged[merged.length - 1]
      } else if (o.length) {
        merged = merged.concat(o.slice(0, limit - merged.length))
        lastO = merged[merged.length - 1]
      }
    }

    const inboxQueryInfo = getQueryInfo({ table: inbox, filter, orderBy })
    const outboxQueryInfo = getQueryInfo({ table: outbox, filter, orderBy })
    const iStartPosition = inbound.items.length && inbound.itemToPosition(inbound.items[0])
    const iEndPosition = lastI && inbound.itemToPosition(lastI)
    const oStartPosition = outbound.items.length && outbound.itemToPosition(outbound.items[0])
    const oEndPosition = lastO && outbound.itemToPosition(lastO)
    const startPosition:InAndOut = {
      inbound: iStartPosition,
      outbound: oStartPosition
    }

    const endPosition:InAndOut = {
      inbound: iEndPosition,
      outbound: oEndPosition
    }

    const itemToPosition = item => {
      const pos:InAndOut = {}
      const inboundIdx = inbound.items.indexOf(item)
      const mergedCopy = orderBy.desc ? merged.slice().reverse() : merged
      if (inboundIdx > -1) {
        pos.inbound = inboxQueryInfo.itemToPosition(item)
        const prevOutbound = mergedCopy.slice(mergedCopy.indexOf(item)).reverse().find(item => outbound.items.includes(item))
        if (prevOutbound) {
          pos.outbound = outboxQueryInfo.itemToPosition(item)
        }
      } else {
        const outboundIdx = outbound.items.indexOf(item)
        if (outboundIdx === -1) {
          throw new Error('invalid item, neither in inbound or outbound')
        }

        pos.outbound = outboxQueryInfo.itemToPosition(item)
        const prevInbound = mergedCopy.slice(mergedCopy.indexOf(item)).reverse().find(item => inbound.items.includes(item))
        if (prevInbound) {
          pos.inbound = inboxQueryInfo.itemToPosition(item)
        }
      }

      return pos
    }

    return {
      items: merged,
      itemToPosition,
      startPosition,
      endPosition,
      // not sure what should we return here
      index: inbound.index
    }
  }

  const find = query => execQuery('find', query)
  const findOne = query => execQuery('findOne', query)
  const get =  async ({ _inbound, ...query }) => {
    const box = _inbound ? inbox : outbox
    return box.get(query)
  }

  const table = {
    exclusive: true,
    get,
    search: find,
    find,
    findOne,
    model,
    name: 'messageTablePlaceholderName'
  }

  ;['put', 'del', 'update', 'batchPut', 'latest'].forEach(method => {
    table[method] = async () => {
      throw new Error(`"${method}" is not supported on tradle.Message table`)
    }
  })

  return table as Table
}

const equalsIgnoreOrder = (a, b) => {
  return a.length === b.length &&
    a.every(str => b.includes(str))
}
