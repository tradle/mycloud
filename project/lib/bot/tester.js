const inherits = require('inherits')
const { EventEmitter } = require('events')
const co = require('co').wrap
const { TYPE, SIG, SEQ } = require('@tradle/constants')
const buildResource = require('@tradle/build-resource')
const tradleUtils = require('@tradle/engine').utils
const { utils, crypto } = require('../')
// const users = [require('../../test/fixtures/user')]

let uCounter = 0

// const nextUser = opts => {
//   uCounter++
//   if (uCounter === users.length) uCounter = 0

//   opts.user = users[uCounter]
//   return new User(opts)
// }

module.exports = function createUser ({ bot, onmessage }) {
  const botFixture = require('../../test/fixtures/bot')
  bot.users = require('../../test/mock/users')()
  bot.identity = botFixture.identity
  bot.keys = botFixture.keys
  const user = require('../../test/fixtures/user')
  return new User({ user, bot, onmessage })
}

function User ({ user, bot, onmessage }) {
  EventEmitter.call(this)

  const self = this
  this.identity = user.identity
  this.permalink = crypto.getPermalink(this.identity)
  this.keys = user.keys
  this.profile = user.profile
  this.bot = bot
  this.userPubKey = tradleUtils.sigPubKey(this.identity)
  this.botPubKey = tradleUtils.sigPubKey(bot.identity)
  this._userSeq = 0
  this._botSeq = 0
  const { send } = bot

  // ugly monkeypatch warning!
  bot.send = co(function* (opts) {
    const { to, object, other={} } = opts
    if (to === self.permalink || to.id === self.permalink) {
      const signed = yield bot.sign({
        author: bot,
        object: {
          [TYPE]: 'tradle.Message',
          [SEQ]: self._botSeq++,
          time: Date.now(),
          recipientPubKey: self.userPubKey,
          object
        }
      })

      self.emit('message', signed)
      if (onmessage) {
        return onmessage(signed)
      }
    }

    return send.apply(this, opts)
  })
}

inherits(User, EventEmitter)

User.prototype.awaitMessage = function () {
  return new Promise(resolve => this.once('message', resolve))
}

User.prototype.sign = function (object) {
  return this.bot.sign({
    author: this,
    object
  })
}

User.prototype.send = co(function* (payload) {
  const message = yield this._createMessage(payload)
  return yield this.bot.trigger('message', message)
})

User.prototype._createMessage = co(function* (payload) {
  if (!payload[SIG]) {
    payload = yield this.sign(payload)
  }

  const message = yield this.sign({
    [TYPE]: 'tradle.Message',
    [SEQ]: this._userSeq++,
    time: Date.now(),
    recipientPubKey: this.botPubKey,
    object: utils.omitVirtual(payload)
  })

  message.object = payload
  return message
})

User.prototype.sendSelfIntroduction = function () {
  const selfIntro = buildResource({
    models: this.bot.models,
    model: this.bot.models['tradle.SelfIntroduction'],
    resource: {
      identity: this.identity,
      name: this.profile.name
    }
  })
  .toJSON()

  return this.send(selfIntro)
}
