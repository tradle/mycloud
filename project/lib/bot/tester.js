process.env.IS_LOCAL = true
process.env.NODE_ENV = 'test'

const inherits = require('inherits')
const { EventEmitter } = require('events')
const coexec = require('co')
const co = require('co').wrap
const debug = require('debug')('@tradle/bot:tester')
const { TYPE, SIG, SEQ } = require('@tradle/constants')
const buildResource = require('@tradle/build-resource')
const mergeModels = require('@tradle/merge-models')
const tradleUtils = require('@tradle/engine').utils
const createProductsStrategy = require('@tradle/bot-products')
const createEmployeeManager = require('@tradle/bot-employee-manager')
const genSample = require('@tradle/gen-samples').fake
const tradle = require('../')
const { utils, crypto, aws, buckets, resources, provider } = tradle
const { extend, clone, omit, batchify } = utils
const { ensureInitialized } = require('../init')
const botFixture = require('../../test/fixtures/bot')
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
    products
  })

  const employeeManager = createEmployeeManager({ productsAPI })
  const employeeModels = productsAPI.models.all
  const customerModels = omit(
    productsAPI.models.all,
    Object.keys(productsAPI.models.private)
  )

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
    send: productsAPI.send.bind(productsAPI)
  })))

  bot.ready()
  return { bot, productsAPI, employeeManager }
}

const endToEndTest = co(function* () {
  const { bot, productsAPI, employeeManager } = createProductsBot()
  const employee = createUser({ bot, name: 'EMPLOYEE' })
  const customer = createUser({ bot, name: 'CUSTOMER' })
  yield [
    employee.identity,
    bot.identity,
    customer.identity
  ].map(identity => {
    crypto.addLinks(identity)
    return Promise.all([
      bot.addressBook.addContact(identity),
      bot.users.del(identity._permalink)
    ])
  })

  debug('EMPLOYEE:', employee.identity._permalink)
  debug('CUSTOMER:', customer.identity._permalink)
  debug('BOT:', bot.identity._permalink)
  const types = []

  function recordType (message) {
    const type = message.object[TYPE]
    if (type !== 'tradle.Message' && !types.includes(type)) {
      types.push(type)
    }
  }

  ;[customer, employee].forEach(user => {
    user.on('message', recordType)
    bot.on('message', recordType)
  })

  yield runThroughApplication({
    productsAPI,
    employeeManager,
    user: employee,
    awaitCertificate: true,
    product: 'tradle.EmployeeOnboarding'
  })

  let context
  employee.on('message', co(function* (message) {
    if (message.object.object) message = message.object
    if (message.context) context = message.context

    const payload = message.object
    const type = payload[TYPE]
    // console.log('EMPLOYEE RECEIVED', type, 'from customer')
    if (productsAPI.models.all[type].subClassOf === 'tradle.Form') {
      yield bot.addressBook.addAuthor(message)
      // employee.send({
      //   object: {
      //     [TYPE]: 'tradle.SimpleMessage',
      //     message: `got ${type}!`
      //   },
      //   other: {
      //     forward: message._author,
      //     context: message.context
      //   }
      // })
    }
  }))

  yield runThroughApplication({
    productsAPI,
    employeeManager,
    user: customer,
    employeeToAssign: employee,
    // awaitCertificate: true,
    product: 'tradle.CurrentAccount'
  })

  const application = yield getApplicationByContext({ productsAPI, context })
  yield employee.send({
    object: buildResource({
        models: productsAPI.models.all,
        model: 'tradle.ApplicationApproval',
      })
      .set({
        application,
        message: 'approved!'
      })
      .toJSON(),
    other: { context }
  })

  yield dumpDB({ bot, types })
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
  const allModels = productsAPI.models.all
  const bizModels = productsAPI.models.biz
  const privateModels = productsAPI.models.private
  const productRequest = buildResource({
      models: allModels,
      model: bizModels.productRequest.id,
    })
    .set('requestFor', product)
    .toJSON()

  user.send({ object: productRequest })

  const assignEmployee = co(function* (context) {
    const application = yield getApplicationByContext({ productsAPI, context })
    const assign = employeeToAssign.send({
      object: buildResource({
        models: allModels,
        model: 'tradle.AssignRelationshipManager',
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
    if (type === 'tradle.FormRequest') {
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
      // console.log('..from employee')
    } else if (!awaitCertificate) {
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
  // try {
  //   yield bot.resources.tables.Users.deleteTable()
  // } catch (err) {
  //   if (err.name !== 'ResourceNotFoundException') {
  //     throw err
  //   }
  // }

  // yield require('../../scripts/gen-local-resources')
  // try {
  //   yield bot.resources.tables.Users.createTable()
  // } catch (err) {
  //   if (err.name !== 'ResourceInUseException') {
  //     throw err
  //   }
  // }

  const existingTables = yield aws.dynamodb.listTables().promise()
  const toDelete = Object.keys(bot.models)
    .filter(id => {
      const name = bot.db.tables[id].name
      return existingTables.TableNames.includes(name)
    })

  const batches = batchify(toDelete, 5)
  yield batches.map(co(function* (batch) {
    yield batch.map(id => {
      return destroyTable(bot.db.tables[id])
    })
  }))
})

// destroy @tradle/dynamodb table
const destroyTable = co(function* (table) {
  let info = yield table.info()
  if (!info) return

  while (true) {
    try {
      yield table.destroy()
      debug(`deleted table: ${table.name}`)
    } catch (err) {
      if (err.name === 'ResourceNotFoundException') {
        break
      }

      if (err.name !== 'LimitExceededException') {
        throw err
      }

      yield wait(1000)
    }
  }
})

function getApplicationByContext ({ productsAPI, context }) {
  return productsAPI.bot.db.findOne({
    type: productsAPI.models.private.application.id,
    filter: {
      EQ: { context }
    }
  })
}

function createUser ({ bot, onmessage, name }) {
  // bot.users = require('../../test/mock/users')()
  bot.identity = botFixture.identity
  bot.keys = botFixture.keys
  const { identity, keys, profile } = nextUserIdentity()
  return new User({
    identity,
    keys,
    bot,
    profile,
    name: name || profile.name.formatted,
    onmessage
  })
}

function User ({ identity, keys, profile, name, bot, onmessage }) {
  EventEmitter.call(this)

  const self = this
  this.name = name
  this.identity = identity
  this.permalink = crypto.getPermalink(this.identity)
  this.keys = keys
  this.profile = profile
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

  this.on('message', message => {
    const types = []
    let envelope = message
    while (envelope.object) {
      types.push(envelope.object[TYPE])
      envelope = envelope.object
    }

    this._debug('received', types.join(' -> '))
  })
}

inherits(User, EventEmitter)

User.prototype.awaitMessage = function () {
  return new Promise(resolve => this.once('message', resolve))
}

User.prototype.sign = function (object) {
  return this.bot.sign(object, this)
}

User.prototype._debug = function (...args) {
  args.unshift(this.name)
  return debug(...args)
}

User.prototype.send = co(function* ({ object, other }) {
  this._debug('sending', object[TYPE])
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
