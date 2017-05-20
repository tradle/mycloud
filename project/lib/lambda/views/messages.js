
const wrap = require('../wrap')
// const { getIdentity } = require('../identities')
const { putMessage } = require('../messages')

// const getMe = getIdentity().then(identity => {
//   me.identity = identity
//   me.link = utils.hexLink(identity)
//   me.permalink = identity[PERMALINK] || utils.hexLink(identity)
//   return me
// })

exports.handler = wrap.generator(function* (event, context) {
  // const me = yield getMe
  // const { topic } = event

  console.log('STUB: inbox/outbox view builder', event)
  yield putMessage(event)
})
