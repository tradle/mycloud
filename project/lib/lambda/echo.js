const debug = require('debug')('tradle:sls:λ:echo')
const wrap = require('../wrap')
const { co } = require('../utils')
const { unmarshalDBItem } = require('../db-utils')
const { loadMessage } = require('../messages')
const { getMostRecentSessionByPermalink } = require('../auth')
const { deliverBatch } = require('../delivery')
const { createSendMessageEvent } = require('../provider')
const { SEQ } = require('../constants')

exports.handler = wrap.generator(function* (event, context) {
  debug('echo [START]', Date.now())
  const items = event.Records.map(record => unmarshalDBItem(record.dynamodb.NewImage))

  for (const metadata of items) {
    debug('loading message', metadata)
    const { message, payload } = yield loadMessage(metadata)
    const promiseSession = getMostRecentSessionByPermalink(message.author)
    const echo = yield createSendMessageEvent({
      recipient: message.author,
      object: payload.object
    })

    let session
    try {
      session = yield promiseSession
    } catch (err) {
      continue
    }

    debug(`sending message ${echo.object[SEQ]} to ${message.author} live`)
    yield deliverBatch({
      clientId: session.clientId,
      permalink: session.permalink,
      messages: [echo]
    })
  }

  // const messages = yield Promise.all(items.map(({ data }) => loadMessage(data)))
  // messages.forEach(function ({ message, payload }) {

  // })
})
