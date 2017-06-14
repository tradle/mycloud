const debug = require('debug')('tradle:sls:λ:echobot')
const omit = require('object.omit')
const bot = require('../bot-engine')
// const { constants } = bot
// const { SIG } = constants

exports.handler = bot.receive(function* ({ message, payload }) {
  debug('[START]', Date.now(), 'message:', JSON.stringify(message))
  yield bot.send({
    recipient: message.author,
    object: payload.object
  })
})

// exports.handler = wrap.generator(function* (event, context) {
//   debug('[START]', Date.now())
//   const items = event.Records.map(record => unmarshalDBItem(record.dynamodb.NewImage))

//   for (const metadata of items) {
//     debug('loading message', metadata)
//     const { message, payload } = yield loadMessage(metadata)
//     const promiseSession = getMostRecentSessionByPermalink(message.author)
//     const echo = yield createSendMessageEvent({
//       recipient: message.author,
//       object: payload.object
//     })

//     let session
//     try {
//       session = yield promiseSession
//     } catch (err) {
//       continue
//     }

//     debug(`sending message ${echo.object[SEQ]} to ${message.author} live`)
//     yield deliverBatch({
//       clientId: session.clientId,
//       permalink: session.permalink,
//       messages: [echo]
//     })
//   }

//   // const messages = yield Promise.all(items.map(({ data }) => loadMessage(data)))
//   // messages.forEach(function ({ message, payload }) {

//   // })
// })
