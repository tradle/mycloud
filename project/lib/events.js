const co = require('co').wrap
const debug = require('debug')('tradle:sls:events')
const typeforce = require('typeforce')
// const { typeforce } = require('@tradle/engine')
const microtime = require('microtime')
const { omit, extend } = require('./utils')
const { PutFailed } = require('./errors')
const { getUpdateExpressions } = require('./db-utils')
const { EventsTable } = require('./tables')

const putEvent = co(function* (event, triesLeft=10) {
  typeforce({
    topic: typeforce.String,
    data: typeforce.Object
  }, event)

  const { topic } = event
  const id = nextEventId()
  const item = extend({ id }, event)
  const expressions = getUpdateExpressions(event)
  try {
    yield EventsTable.update(extend({
      Key: { id },
      ConditionExpression: 'attribute_not_exists(id)'
    }, expressions))
  } catch (err) {
    if (err.code === 'ConditionalCheckFailedException') {
      if (triesLeft === 0) throw new PutFailed(`for "${topic}" event`)

      // try again
      debug('write event failed, retrying')
      return putEvent(event, --triesLeft)
    }

    debug('write event failed', err.stack)
    throw err
  }

  debug(`saved "${topic}" event, id: ${id}`)
  return event
})

function nextEventId () {
  const [seconds, microseconds] = microtime.nowStruct()
  return `${seconds}${microseconds}`
}

module.exports = { putEvent }
