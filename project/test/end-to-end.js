require('./env')

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
const { replaceDataUrls } = require('@tradle/embed')
const dbUtils = require('../lib/db-utils')
const Delivery = require('../lib/delivery')
// const { extractAndUploadEmbeds } = require('@tradle/aws-client').utils
const tradle = require('../')
const { utils, crypto, aws, buckets, resources, provider, objects, s3Utils } = tradle
const { extend, clone, pick, omit, batchify } = utils
const { ensureInitialized } = require('../lib/init')
const botFixture = require('./fixtures/bot')
const userIdentities = require('./fixtures/users-pem')
const createProductsBot = require('../lib/bot/strategy').products
const intercept = require('./interceptor')
const nextUserIdentity = (function () {
  let i = 0
  return function () {
    return userIdentities[i++]
  }
}())

const credentials = (function () {
  const { credentials } = aws.AWS.config
  return pick(credentials, ['accessKeyId', 'secretAccessKey'])
}())

const createBot = require('../lib/bot')
const baseModels = require('../lib/models')
const defaultModels = mergeModels()
  .add(baseModels)
  .get()

const defaultProducts = ['nl.tradle.DigitalPassport']
// const users = [require('../../test/fixtures/user')]

let uCounter = 0

// const nextUser = opts => {
//   uCounter++
//   if (uCounter === users.length) uCounter = 0

//   opts.user = users[uCounter]
//   return new User(opts)
// }

const endToEndTest = co(function* (opts={}) {
  const {
    approve=true,
    products=defaultProducts
  } = opts

  const {
    tradle,
    bot,
    productsAPI,
    employeeManager
  } = createProductsBot({ products })

  // const authenticate = function authenticate (user) {
  //   return tradle.auth.onAuthenticated({
  //     clientId: user.permalink.repeat(2),
  //     permalink: user.permalink,
  //     clientPosition: {},
  //     serverPosition: {},
  //   })
  // }

  bot.ready()

  const employee = createUser({ bot, name: 'EMPLOYEE' })
  const customer = createUser({ bot, name: 'CUSTOMER' })
  const interceptor = intercept({
    bot,
    onmessage: function ({ permalink, messages }) {
      if (permalink === employee.permalink) {
        yield
      }
    }
  })

  yield [
    employee.identity,
    bot.identity,
    customer.identity
  ].map(identity => {
    crypto.addLinks(identity)
    return Promise.all([
      bot.addressBook.addContact(identity),
      bot.users.del(identity._permalink)
        .catch(err => {
          if (err.name !== 'ResourceNotFoundException') {
            throw err
          }
        })
    ])
  })

  // yield [
  //   authenticate(employee),
  //   authenticate(customer)
  // ]

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

    // pre-signed urls don't work in localstack yet
    // so resolve with root credentials
    if (payload[TYPE] === 'tradle.PhotoID') {
      console.log(payload.scan.url)
    }

    yield objects.resolveEmbeds(payload)

    // console.log('EMPLOYEE RECEIVED', JSON.stringify(payload, null, 2))
    // const type = payload[TYPE]
    // if (productsAPI.models.all[type].subClassOf === 'tradle.Form') {
    //   yield bot.addressBook.addAuthorInfo(message)
    // }
  }))

  yield runThroughApplication({
    productsAPI,
    employeeManager,
    user: customer,
    employeeToAssign: employee,
    // awaitCertificate: true,
    product: products[0]
  })

  const application = yield getApplicationByContext({ productsAPI, context })
  const approval = buildResource({
      models: productsAPI.models.all,
      model: 'tradle.ApplicationApproval',
    })
    .set({
      application,
      message: 'approved!'
    })
    .toJSON()

  const denial = buildResource({
      models: productsAPI.models.all,
      model: 'tradle.ApplicationDenial',
    })
    .set({
      application,
      message: 'denied!'
    })
    .toJSON()

  const judgment = approve ? approval : denial
  yield employee.send({
    object: judgment,
    other: { context }
  })

  interceptor.restore()
  // uncomment to dump dbs to screen
  // yield dumpDB({ bot, types })
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
  const toDelete = existingTables.TableNames

  // const toDelete = Object.keys(bot.models)
  //   .filter(id => {
  //     const name = bot.db.tables[id].name
  //     return existingTables.TableNames.includes(name)
  //   })

  const batches = batchify(toDelete, 5)
  yield batches.map(co(function* (batch) {
    yield batch.map(id => {
      return destroyTable(id)//bot.db.tables[id])
    })
  }))
})

const destroyTable = co(function* (TableName) {
  while (true) {
    try {
      yield dbUtils.deleteTable({ TableName })
      debug(`deleted table: ${TableName}`)
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

function createUser ({ tradle, bot, onmessage, name }) {
  // bot.users = require('../../test/mock/users')()
  bot.identity = botFixture.identity
  bot.keys = botFixture.keys
  const { identity, keys, profile } = nextUserIdentity()
  return new User({
    tradle,
    identity,
    keys,
    bot,
    profile,
    name: name || profile.name.formatted,
    onmessage
  })
}

function User ({ tradle, identity, keys, profile, name, bot, onmessage }) {
  EventEmitter.call(this)

  const self = this
  this.name = name
  this.identity = identity
  this.permalink = crypto.getPermalink(this.identity)
  this.clientId = this.permalink.repeat(2)
  this.keys = keys
  this.profile = profile
  this.bot = bot
  this.userPubKey = tradleUtils.sigPubKey(this.identity)
  this.botPubKey = tradleUtils.sigPubKey(bot.identity)
  this._userSeq = 0
  this._botSeq = 0

  // const { send } = bot
  this.on('message', message => {
    const types = []
    let envelope = message
    while (envelope.object) {
      types.push(envelope.object[TYPE])
      envelope = envelope.object
    }

    this._debug('received', types.join(' -> '))
  })

  Delivery.on('message', ({ permalink, message }) => {
    if (permalink === this.permalink) {
      this.emit('message', message)
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

User.prototype._debug = function (...args) {
  args.unshift(this.name)
  return debug(...args)
}

User.prototype.send = co(function* ({ object, other }) {
  this._debug('sending', object[TYPE])
  const message = yield this._createMessage({ object, other })
  const userSim = require('../lib/user')
  yield userSim.onSentMessage({
    clientId: this.clientId,
    message
  })

  // return yield this.bot.process.message.handler(message)
  // return yield this.bot.trigger('message', message)
})

User.prototype._createMessage = co(function* ({ object, other={} }) {
  if (!object[SIG]) {
    object = yield this.sign(object)
  }

  const unsigned = extend({
    [TYPE]: 'tradle.Message',
    [SEQ]: this._userSeq++,
    time: Date.now(),
    recipientPubKey: this.botPubKey,
    object: utils.omitVirtual(object)
  }, other)

  const message = yield this.sign(unsigned)
  message.object = object // with virtual props
  const replacements = replaceDataUrls({
    host: aws.s3.endpoint,
    // region,
    object,
    bucket: buckets.FileUpload.name,
    keyPrefix: `test-${this.permalink}`
  })

  if (replacements.length) {
    yield replacements.map(({ key, bucket, body, mimetype }) => {
      return s3Utils.put({ key, bucket, value: body, contentType: mimetype })
    })

    debug('uploaded embedded media')
  }

  yield this.bot.save(object)
  // const uploaded = yield extractAndUploadEmbeds({
  //   host: s3Host,
  //   object,
  //   credentials,
  //   bucket: buckets.FileUpload.name,
  //   keyPrefix: `test-${this.permalink}`
  // })

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

function wait (millis) {
  return new Promise(resolve => setTimeout(resolve, millis))
}

function getPubKeyString (pub) {
  if (Array.isArray(pub)) {
    pub = new Buffer(pub)
  }

  return pub.toString('hex')
}

module.exports = {
  createUser,
  createProductsBot,
  endToEndTest,
  clear
}
