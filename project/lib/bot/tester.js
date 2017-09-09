process.env.IS_LOCAL = true
process.env.NODE_ENV = 'test'

const inherits = require('inherits')
const { EventEmitter } = require('events')
const coexec = require('co')
const co = require('co').wrap
const { TYPE, SIG, SEQ } = require('@tradle/constants')
const buildResource = require('@tradle/build-resource')
const mergeModels = require('@tradle/merge-models')
const tradleUtils = require('@tradle/engine').utils
const createProductsStrategy = require('@tradle/bot-products')
const createEmployeeManager = require('@tradle/bot-employee-manager')
const genSample = require('@tradle/gen-samples').fake
const tradle = require('../')
const { utils, crypto, aws, buckets, resources, provider } = tradle
const { extend, clone } = utils
const { ensureInitialized } = require('../init')
const userIdentities = require('../../test/fixtures/users-pem')
const nextUserIdentity = (function () {
  let i = 0
  return function () {
    return userIdentities[i++]
  }
}())

const createBot = require('./')
const baseModels = require('./base-models')
const defaultModels = mergeModels()
  .add(baseModels)
  .get()

const defaultProducts = ['tradle.CurrentAccount']
// const users = [require('../../test/fixtures/user')]

let uCounter = 0

// const nextUser = opts => {
//   uCounter++
//   if (uCounter === users.length) uCounter = 0

//   opts.user = users[uCounter]
//   return new User(opts)
// }

function createProductsBot (opts={}) {
  const {
    models=defaultModels,
    products=defaultProducts
  } = opts

  const productsAPI = createProductsStrategy({
    namespace: 'test.bot',
    models: {
      all: models
    },
    products,
    // handlers: PRODUCT === DEPLOYMENT ? require('./deployment-handlers') : {}
  })

  const employeeManager = createEmployeeManager({ productsAPI })
  const employeeModels = clone(productsAPI.models.all, employeeManager.models.all)
  const customerModels = productsAPI.models.all
  const bot = createBot.fromEngine({
    tradle,
    models: productsAPI.models.all
  })

  productsAPI.install(bot)
  // productsAPI.plugins.use({
  //   onFormsCollected: productsAPI.issueCertificate
  // })

  bot.hook('message', createProductsStrategy.keepModelsFresh(({
    getModelsForUser: user => {
      return employeeManager.isEmployee(user) ? employeeModels : customerModels
    },
    send: ({ user, object }) => {
      return productsAPI.send({ user, object })
    }
  })))

  bot.ready()
  return { bot, productsAPI, employeeManager }
}

const endToEndTest = co(function* () {
  const { bot, productsAPI, employeeManager } = createProductsBot()
  const employee = createUser({ bot })
  yield [
    bot.addressBook.addContact(employee.identity),
    bot.addressBook.addContact(bot.identity)
  ]

  yield runThroughApplication({
    productsAPI,
    employeeManager,
    user: employee,
    awaitCertificate: true,
    product: 'tradle.EmployeeOnboarding'
  })

  employee.on('message', co(function* (message) {
    if (message.object.object) message = message.object

    const payload = message.object
    const type = payload[TYPE]
    console.log('EMPLOYEE RECEIVED', type)
    if (productsAPI.models.all[type].subClassOf === 'tradle.Form') {
      yield bot.addressBook.addAuthor(message)
      employee.send({
        object: {
          [TYPE]: 'tradle.SimpleMessage',
          message: `got ${type}!`
        },
        other: {
          forward: message._author,
          context: message.context
        }
      })
    }
  }))

  const user = createUser({ bot })
  yield bot.addressBook.addContact(user.identity)
  yield runThroughApplication({
    productsAPI,
    employeeManager,
    user,
    employeeToAssign: employee,
    awaitCertificate: true,
    product: 'tradle.CurrentAccount'
  })
})

const runThroughApplication = co(function* ({
  productsAPI,
  employeeManager,
  user,
  awaitCertificate,
  product,
  employeeToAssign
}) {
  yield user.sendSelfIntroduction()
  const allModels = clone(productsAPI.models.all, employeeManager.models.all)
  const bizModels = productsAPI.models.biz
  const privateModels = productsAPI.models.private
  const productRequest = buildResource({
      models: allModels,
      model: bizModels.productRequest.id,
    })
    .set('requestFor', product)
    .toJSON()

  user.send({ object: productRequest })

  const types = [
    bizModels.productRequest.id,
    privateModels.application.id,
    'tradle.FormRequest',
    'tradle.MyEmployeeOnboarding'
  ]

  const assignEmployee = co(function* (context) {
    const application = yield productsAPI.bot.db.findOne({
      type: privateModels.application.id,
      filter: {
        EQ: { context }
      }
    })

    const assign = employeeToAssign.send({
      object: buildResource({
        models: allModels,
        model: privateModels.assignRM,
        resource: {
          employee: buildResource.stub({
            models: allModels,
            resource: employeeToAssign.identity
          }),
          application: buildResource.stub({
            models: allModels,
            resource: application
          })
        }
      }).toJSON()
    })

    const getIntroduced = user.awaitMessage()
    yield [getIntroduced, assign]
  })

  let assignedEmployee
  while (true) {
    let { context, object } = yield user.awaitMessage()
    if (employeeToAssign && !assignedEmployee) {
      yield assignEmployee(context)
      assignedEmployee = true
    }

    let type = object[TYPE]

    console.log('USER RECEIVED', type)
    if (!types.includes(type)) {
      types.push(type)
    }

    if (type === 'tradle.FormRequest') {
      types.push(object.form)
      console.log('USER SENDING', object.form)
      let form = genSample({
        models: productsAPI.models.all,
        model: productsAPI.models.all[object.form]
      })
      .value

      // if (assignedEmployee) {
      //   yield wait(1000)
      // }

      user.send({
        object: form,
        other: { context }
      })

    } else if (type === 'tradle.ModelsPack') {
      continue
    } else if (allModels[type].subClassOf === 'tradle.MyProduct') {
      break
    } else if (type === 'tradle.Message') {
      console.log('..from employee')
    } else if (!awaitCertificate) {
      debugger
      break
    }
  }
})

const dumpDB = co(function* ({ bot, types }) {
  const results = yield types.map(type => bot.db.search({ type }))
  types.forEach((type, i) => {
    console.log(type)
    console.log(JSON.stringify(results[i].items, null, 2))
  })
})

const clear = co(function* (opts) {
  const { bot } = createProductsBot()
  for (let id in bot.db.tables) {
    let table = bot.db.tables[id]
    let info = yield table.info()
    if (info) yield table.destroy()
  }
})

function createUser ({ bot, onmessage }) {
  const botFixture = require('../../test/fixtures/bot')
  bot.users = require('../../test/mock/users')()
  bot.identity = botFixture.identity
  bot.keys = botFixture.keys

  // bot.identities.addAuthor = co(function* (object) {
  //   const sigPubKey = crypto.extractSigPubKey(object)
  // })

  // bot.identities.byPubMini = co(function* (pub) {
  //   return userIdentities.find(user => {
  //     return user.identity.pubkeys.some(key => key.pub === pub)
  //   }).identity
  // })

  // bot.identities.byPermalink = co(function* (permalink) {
  //   return userIdentities.find(user => {
  //     return buildResource.permalink(user.identity) === permalink
  //   }).identity
  // })

  const user = nextUserIdentity()
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
    let { to, object, other={} } = opts
    if (to !== self.permalink && to.id !== self.permalink) {
      return send.call(this, opts)
    }

    if (!object[SIG]) object = yield bot.sign(object)

    const save = bot.save(object)
    const signMessage = bot.sign(extend({
      [TYPE]: 'tradle.Message',
      [SEQ]: self._botSeq++,
      time: Date.now(),
      recipientPubKey: self.userPubKey,
      object
    }, other))

    const [signedMessage] = yield [signMessage, save]
    self.emit('message', signedMessage)
    if (onmessage) {
      return onmessage(signedMessage)
    }
  })
}

inherits(User, EventEmitter)

User.prototype.awaitMessage = function () {
  return new Promise(resolve => this.once('message', resolve))
}

User.prototype.sign = function (object) {
  return this.bot.sign(object, this)
}

User.prototype.send = co(function* ({ object, other }) {
  const message = yield this._createMessage({ object, other })
  return yield this.bot.trigger('message', message)
})

User.prototype._createMessage = co(function* ({ object, other={} }) {
  if (!object[SIG]) {
    object = yield this.sign(object)
  }

  const savePayload = this.bot.save(object)
  const unsigned = extend({
    [TYPE]: 'tradle.Message',
    [SEQ]: this._userSeq++,
    time: Date.now(),
    recipientPubKey: this.botPubKey,
    object: utils.omitVirtual(object)
  }, other)

  const signMessage = this.sign(unsigned)
  const [message] = yield [signMessage, savePayload]
  message.object = object // with virtual props
  return message
})

User.prototype.sendSelfIntroduction = function () {
  const selfIntro = buildResource({
    models: this.bot.models,
    model: this.bot.models['tradle.SelfIntroduction'],
    resource: {
      identity: this.identity,
      name: this.profile.name.formatted
    }
  })
  .toJSON()

  return this.send({ object: selfIntro })
}

module.exports = {
  createUser,
  createProductsBot,
  endToEndTest,
  clear
}

coexec(function* () {
  yield clear()
  yield endToEndTest()
})
.catch(err => {
  console.error(err)
  process.exit(1)
})

function wait (millis) {
  return new Promise(resolve => setTimeout(resolve, millis))
}

function getPubKeyString (pub) {
  if (Array.isArray(pub)) {
    pub = new Buffer(pub)
  }

  return pub.toString('hex')
}
