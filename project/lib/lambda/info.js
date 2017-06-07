const wrap = require('../wrap')
const { getMyIdentity } = require('../author')
const {
  serverlessStage,
  serverlessService
} = require('../env')

exports.handler = wrap.httpGenerator(function* (event, context) {
  console.log('event', event)
  console.log('context', context)
  const me = yield getMyIdentity()
  return {
    authEndpoint: `${event.headers.Host}/${serverlessStage}/tradle`,
    identity: me.object
  }
})
