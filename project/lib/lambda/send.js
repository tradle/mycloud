
exports.handler = wrap.generator(function* (items, context, cb) {
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
})
