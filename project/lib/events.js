const co = require('co').wrap
const debug = require('debug')('tradle:sls:events')
const { omit, extend, timestamp } = require('./utils')
const Tables = require('./tables')

function putEvents (events) {
  setIds(events)
  return Tables.EventsTable.batchPut(events)
}

function setIds (events) {
  events.sort((a, b) => {
    return a.data.time - b.data.time
  })

  events.forEach((event, i) => {
    if (i === 0) {
      event.id = event.data.time + ''
      return
    }

    const prevId = events[i - 1].id
    event.id = getNextUniqueId(prevId, event.data.time + '')
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

module.exports = {
  putEvents
}
