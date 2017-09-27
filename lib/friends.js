const debug = require('debug')('tradle:sls:friends')
const co = require('co').wrap
const fetch = require('node-fetch')
const buildResource = require('@tradle/build-resource')
const { addLinks } = require('./crypto')
const FRIEND_TYPE = 'tradle.MyCloudFriend'

module.exports = Friends

function Friends ({ models, db, identities, provider }) {
  this.models = models
  this.model = models[FRIEND_TYPE]
  this.db = db
  this.addContact = identities.addContact
  this.signObject = provider.signObject
}

Friends.prototype.load = co(function* ({ name, url }) {
  url = url.replace(/[/]+$/, '')

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

  yield this.add({
    name,
    url,
    org,
    publicConfig,
    identity: pub
  })
})

Friends.prototype.add = co(function* (props) {
  const { models, model } = this
  const { identity } = props
  addLinks(identity)

  const object = buildResource({ models, model })
    .set(props)
    .toJSON()

  const signed = yield this.signObject({ object })
  buildResource.setVirtual(signed, {
    _time: Date.now(),
    _identityPermalink: buildResource.permalink(identity)
  })

  yield [
    this.addContact(identity),
    this.db.merge(signed)
  ]

  return signed
})

Friends.prototype.get = function get ({ permalink }) {
  return this.db.findOne({
    type: FRIEND_TYPE,
    filter: {
      EQ: {
        _identityPermalink: permalink
      }
    }
  })
}

Friends.prototype.list = function list ({ permalink }) {
  return this.db.find({
    type: FRIEND_TYPE,
    orderBy: {
      property: '_time',
      desc: true
    }
  })
}


function getInfoEndpoint (url) {
  if (!url.endsWith('/info')) {
    url += '/info'
  }

  return url
}

// function get ({ permalink }) {
//   return db.latest({
//     [TYPE]: FRIEND_TYPE,
//     _permalink
//   })
// }

// co(function* () {
//   yield load({
//     name: 'Tradle',
//     url: 'https://7hixz15a6k.execute-api.us-east-1.amazonaws.com/dev/tradle'
//   })
// })()
// .catch(console.error)
