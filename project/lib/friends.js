const debug = require('debug')('tradle:sls:friends')
const co = require('co').wrap
const fetch = require('node-fetch')
const buildResource = require('@tradle/build-resource')
const { addLinks } = require('./crypto')
const { models, db, provider } = require('./')
const FRIEND_TYPE = 'tradle.MyCloudFriend'
const model = models[FRIEND_TYPE]

module.exports = Friends

function Friends ({ db, identities, provider }) {
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

  addLinks(pub)
  yield this.add({
    name,
    url,
    org,
    publicConfig,
    bot: pub
  })
})

Friends.prototype.add = co(function* (props) {
  const { bot } = props
  const object = buildResource({
      models,
      model
    })
    .set(props)
    .toJSON()

  const signed = yield this.signObject({ object })
  buildResource.setVirtual(signed, {
    _time: Date.now(),
    _botPermalink: buildResource.permalink(bot)
  })

  yield [
    this.addContact(bot),
    this.db.merge(signed)
  ]

  return signed
})

Friends.prototype.getByBotPermalink = function getByBotPermalink ({ permalink }) {
  return this.db.findOne({
    type: FRIEND_TYPE,
    filter: {
      EQ: {
        _botPermalink: permalink
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
