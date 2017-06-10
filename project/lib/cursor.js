const util = require('util')
const { EventEmitter } = require('events')
const debug = require('debug')('tradle:sls:cursor')
const { co } = require('./utils')
const { getTable } = require('./db-utils')
const defaults = {
  queueProp: 'queue',
  seqProp: 'seq',
  batchSize: 5
}

module.exports = function (tableName) {
  return new Cursor(tableName)
}

function Cursor ({
  cursorTable,
  itemsTable,
  queueProp=defaults.queueProp,
  seqProp=defaults.seqProp,
  batchSize=defaults.batchSize
}) {
  EventEmitter.call(this)
  this.cursor = getTable(cursorTable)
  this.items = getTable(itemsTable)
  this.queueProp = queueProp
  this.seqProp = seqProp
  this.batchSize = batchSize
}

util.inherits(Cursor, EventEmitter)

const proto = Cursor.prototype

proto._parseProps = function (props) {
  const queue = props[this.queueProp]
  const seq = props[this.seqProp]
  return { queue, seq }
}

proto._exportProps = function ({ queue, seq }) {
  return {
    [this.queueProp]: queue,
    [this.seqProp]: seq
  }
}

proto.set = co(function* (props) {
  const parsed = this._parseProps(props)
  const { queue, seq } = parsed
  const { queueProp, seqProp } = this
  debug(`setting cursor ${queue} to ${seq}`)
  this.emit('change', {
    [queueProp]: queue,
    [seqProp]: seq
  })

  yield this.cursor.put({
    Key: props,
    Item: props
  })
})

proto.setIfInOrder = co(function* (props) {
  props = this._parseProps(props)
  const { queue, seq } = props

  let last
  try {
    last = yield this.cursor.findOne({
      KeyConditionExpression: `${this.queueProp} = :${this.queueProp}`,
      ExpressionAttributeValues: {
        [`:${this.queueProp}`]: queue
      },
      Limit: true,
      ScanIndexForward: false
    })
  } catch (err) {
    last = { [this.seqProp]: -1 }
  }

  last = this._parseProps(last)
  if (seq <= last.seq) {
    debug(`skipping ${seq} in ${queue}, already did ${last.seq}`)
    return
  }

  if (seq !== last.seq + 1) {
    throw new Error(`out of order: expected ${last.seq + 1}, got ${seq}`)
  }

  yield this.set(this._exportProps({ queue, seq }))
})

proto.scan = co(function* (props) {
  const { batchSize=this.batchSize } = props
  const { queue, seq } = this._parseProps(props)
  const { queueProp, seqProp } = this
  let results = yield this.items.find({
    KeyConditionExpression: `${queueProp} = :queue AND ${seqProp} between :gte and :lte`,
    ExpressionAttributeValues: {
      ':queue': queue,
      ':gte': seq + 1,
      ':lte': seq + batchSize
    },
    Limit: batchSize
  })

  results = results
    .map(result => this._parseProps(result))
    .sort((a, b) => a.seq - b.seq)

  let curSeq = seq
  while (results.length) {
    let result = results.shift()
    if (result.seq !== curSeq + 1) break

    curSeq++
  }

  if (curSeq === seq) return

  debug(`jumping cursor ${queue} to ${curSeq}`)
  yield this.set(this._exportProps({ queue, seq: curSeq }))
  return curSeq
})

proto.setIfInOrderAtomic = co(function* (props) {
  const { queue, seq } = this._parseProps(props)
  const { queueProp, seqProp } = this
  const ExpressionAttributeValues = {
    ':seq': seq
  }

  let ConditionExpression
  if (seq === 0) {
    ConditionExpression = `attribute_not_exists(${queueProp})`
  } else {
    ConditionExpression = `${queueProp} = :queue AND ${seqProp} = :prevseq`
    ExpressionAttributeValues[':prevseq'] = seq - 1
    ExpressionAttributeValues[':queue'] = author
  }

  yield this.cursor.update({
    Key: { author },
    ConditionExpression,
    UpdateExpression: `SET ${seqProp} = :seq`,
    ExpressionAttributeValues
  })
})
