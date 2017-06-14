const co = require('co').wrap
const debug = require('debug')('tradle:sls:events')
const typeforce = require('typeforce')
// const { typeforce } = require('@tradle/engine')
const { omit, extend, timestamp } = require('./utils')
const { PutFailed } = require('./errors')
const { getUpdateParams } = require('./db-utils')
const { EventsTable } = require('./tables')

const putEvent = co(function* (event, triesLeft=10) {
  typeforce({
    topic: typeforce.String,
    data: typeforce.Object
  }, event)

  let { topic, id=genId() } = event

  const item = extend({ id }, event)
  if (!item.time) {
    item.time = Number(id)
  }

  const params = getUpdateParams(event)
  try {
    yield EventsTable.update(extend({
      Key: { id },
      ConditionExpression: 'attribute_not_exists(id)'
    }, params))
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') {
      if (triesLeft === 0) throw new PutFailed(`for "${topic}" event`)

      // try again
      debug('write event failed, retrying')
      event.id = getNextUniqueId(event.id, event.id)
      return putEvent(event, --triesLeft)
    }

    debug('write event failed', err.stack)
    throw err
  }

  debug(`saved "${topic}" event, id: ${id}`)
  return event
})

function putEvents (events) {
  setIds(events)
  return EventsTable.batchPut(events)
}

function setIds (events) {
  events.sort((a, b) => {
    return a.time - b.time
  })

  events.forEach((event, i) => {
    if (i === 0) {
      event.id = event.time + ''
      return
    }

    const prevId = events[i - 1].id
    event.id = getNextUniqueId(prevId, event.time + '')
  })

  return events
}

function genId () {
  return timestamp() + ''
}

function getNextUniqueId (prev, next) {
  return prev === next ? bumpSuffix(prev) : next
}

function bumpSuffix (id) {
  const [main, suffix='0'] = id.split('.')
  return main + (Number(suffix) + 1)
}

module.exports = { putEvent }
