const debug = require('debug')('tradle:sls:friends')
const co = require('co').wrap
const fetch = require('node-fetch')
const buildResource = require('@tradle/build-resource')
const { addLinks } = require('./crypto')
const { addContact } = require('./identities')
const { models, db, provider } = require('./')
const FRIEND_TYPE = 'tradle.MyCloudFriend'
const model = models[FRIEND_TYPE]

const load = co(function* ({ name, url }) {
  const infoUrl = getInfoEndpoint(url)
  const res = yield fetch(infoUrl)
  if (res.status > 300) {
    throw new Error(res.statusText)
  }

  const info = yield res.json()
  const {
    bot: { pub },
    org,
    publicConfig
  } = info

  const object = buildResource({
      models,
      model
    })
    .set({
      name,
      url,
      bot: pub,
      org,
      publicConfig
    })
    .toJSON()

  const signed = yield provider.signObject({ object })
  buildResource.setVirtual(signed, {
    _time: Date.now(),
    // _botPermalink: pub._permalink
  })

  yield [
    addContact(pub),
    db.merge(signed)
  ]

  return signed
})

function getInfoEndpoint (url) {
  url = url.replace(/[/]+$/, '')
  if (!url.endsWith('/info')) {
    url += '/info'
  }

  return url
}

function get ({ permalink }) {
  return db.latest({
    type: FRIEND_TYPE,
    permalink
  })
}

module.exports = {
  load,
  get
}

// co(function* () {
//   yield load({
//     name: 'Tradle',
//     url: 'https://7hixz15a6k.execute-api.us-east-1.amazonaws.com/dev/tradle'
//   })
// })()
// .catch(console.error)
