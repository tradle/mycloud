const debug = require('debug')('tradle:sls:λ:echo')
const wrap = require('../wrap')
const { co } = require('../utils')
const { unmarshalDBItem } = require('../db-utils')
const { loadMessage } = require('../messages')
const { getSessionsByPermalink } = require('../auth')
const { deliverBatch } = require('../delivery')
const { createSendMessageEvent } = require('../author')

exports.handler = wrap.generator(function* (event, context) {
  const items = event.Records.map(record => unmarshalDBItem(record.dynamodb.NewImage))

  for (const metadata of items) {
    debug('loading message', metadata)
    const { message, payload } = yield loadMessage(metadata)
    const promiseSessions = getSessionsByPermalink(message.author)
      .then(sessions => sessions.filter(session => session.authenticated))

    const echo = yield createSendMessageEvent({
      recipient: message.author,
      object: payload.object
    })

    let sessions
    try {
      sessions = yield promiseSessions
    } catch (err) {
      continue
    }

    for (let session of sessions) {
      yield deliverBatch({
        clientId: session.clientId,
        permalink: session.permalink,
        messages: [echo]
      })
    }
  }

  // const messages = yield Promise.all(items.map(({ data }) => loadMessage(data)))
  // messages.forEach(function ({ message, payload }) {

  // })
})

