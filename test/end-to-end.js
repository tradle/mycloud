require('./env')
const nock = require('nock')

const assert = require('assert')
const inherits = require('inherits')
const { EventEmitter } = require('events')
const coexec = require('co')
const co = require('co').wrap
const debug = require('debug')('@tradle/bot:tester')
const { TYPE, TYPES, SIG, SEQ } = require('@tradle/constants')
const { MESSAGE } = TYPES
const buildResource = require('@tradle/build-resource')
const mergeModels = require('@tradle/merge-models')
const tradleUtils = require('@tradle/engine').utils
const createProductsStrategy = require('@tradle/bot-products')
const createEmployeeManager = require('@tradle/bot-employee-manager')
const genSample = require('@tradle/gen-samples').fake
const { replaceDataUrls } = require('@tradle/embed')
// const dbUtils = require('../lib/db-utils')
// const Delivery = require('../lib/delivery')
// const { extractAndUploadEmbeds } = require('@tradle/aws-client').utils
const defaultTradleInstance = require('../')
const { wrap, utils, crypto } = require('../')
const { extend, clone, pick, omit, batchify } = utils
const botFixture = require('./fixtures/bot')
const userIdentities = require('./fixtures/users-pem')
const createProductsBot = require('../lib/bot/strategy').products
const intercept = require('./interceptor')
const { reprefixServices } = require('./utils')
const nextUserIdentity = (function () {
  let i = 0
  return function () {
    return userIdentities[i++]
  }
}())

// const credentials = (function () {
//   const { credentials } = aws.AWS.config
//   return pick(credentials, ['accessKeyId', 'secretAccessKey'])
// }())

const createBot = require('../lib/bot')
const baseModels = require('../lib/models')
const defaultModels = mergeModels()
  .add(baseModels)
  .get()

const defaultProducts = ['nl.tradle.DigitalPassport']

function E2ETest (opts={}) {
  const {
    products=defaultProducts,
    tradle=defaultTradleInstance.new()
  } = opts

  const {
    bot,
    productsAPI,
    employeeManager
  } = createProductsBot({ products, tradle })

  extend(bot, nextUserIdentity())

  this.tradle = tradle
  this.bot = bot
  this.productsAPI = productsAPI
  this.employeeManager = employeeManager
  this.products = products
  this._ready = bot.addressBook.addContact(bot.identity)
    .then(() => this.bot.ready())
}

const proto = E2ETest.prototype

proto.runEmployeeAndCustomer = wrapWithIntercept(co(function* () {
  yield this._ready

  const { tradle, bot } = this
  const employee = createUser({ bot, tradle, name: 'employee' })
  const customer = createUser({ bot, tradle, name: 'customer' })
  const employeeApp = yield this.onboardEmployee({ user: employee })
  employee.on('message', co(function* (message) {
    if (message.object[TYPE] === MESSAGE) {
      message = message.object
    } else {
      return
    }

    const hey = {
      [TYPE]: 'tradle.SimpleMessage',
      message: 'hey'
    }

    yield employee.send({
      other: {
        forward: message._author
      },
      object: hey
    })
  }))

  const application = yield this.onboardCustomer({
    user: customer,
    relationshipManager: employee
  })

  yield this.approve({
    employee,
    user: customer,
    application
  })
}))

proto.runEmployeeAndFriend = wrapWithIntercept(co(function* () {
  yield this._ready
  const { tradle, bot, productsAPI } = this
  const allModels = productsAPI.models.all
  const employee = createUser({ bot, tradle, name: 'employee' })
  yield this.onboardEmployee({ user: employee })

  const { friends } = tradle
  const url = 'http://localhost:12345'
  const friend = {
    name: 'friendly bank',
    identity: nextUserIdentity().identity,
    url
  }

  yield friends.add(friend)
  const hey = {
    [TYPE]: 'tradle.SimpleMessage',
    message: 'hey'
  }

  const identityPermalink = buildResource.permalink(friend.identity)
  this.interceptor.httpOnly(identityPermalink)
  nock(url)
    .post('/inbox')
    .reply(function (uri, body) {
      const { messages } = body
      assert.equal(messages.length, 1)
      const msg = messages[0]
      assert.equal(msg.object[TYPE], MESSAGE)
      assert.deepEqual(pick(msg.object.object, Object.keys(hey)), hey)
      return [
        201
      ]
    })

  yield employee.send({
    other: {
      forward: identityPermalink
    },
    object: hey
  })
}))

proto.onboardEmployee = co(function* ({ user }) {
  return yield this.runThroughApplication({
    user,
    awaitCertificate: true,
    product: 'tradle.EmployeeOnboarding'
  })
})

proto.onboardCustomer = co(function* ({
  user,
  relationshipManager,
  product
}) {
  const { tradle } = this

  if (relationshipManager) {
    let context
    relationshipManager.on('message', co(function* (message) {
      if (message.object.object) message = message.object
      if (message.context) context = message.context

      const payload = message.object

      // pre-signed urls don't work in localstack yet
      // so resolve with root credentials
      // if (payload[TYPE] === 'tradle.PhotoID') {
      //   console.log(payload.scan.url)
      // }

      yield tradle.objects.resolveEmbeds(payload)

      console.log('EMPLOYEE RECEIVED', payload[TYPE])
      // const type = payload[TYPE]
      // if (productsAPI.models.all[type].subClassOf === 'tradle.Form') {
      //   yield bot.addressBook.addAuthorInfo(message)
      // }
    }))
  }

  const application = yield this.runThroughApplication({
    user,
    relationshipManager,
    product: product || this.products[0]
  })

  return application
})

proto.approve = function (opts) {
  opts.approve = true
  return this.judge(opts)
}

proto.reject = function (opts) {
  opts.approve = false
  return this.judge(opts)
}

proto.judge = co(function* ({
  employee,
  user,
  application,
  context,
  approve=true
}) {
  const { bot, productsAPI } = this
  if (application) {
    context = application.context
  } else {
    application = yield this.getApplicationByContext({ context })
  }

  // if (!employee) return

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
  yield (employee || bot).send({
    object: judgment,
    other: { context }
  })

  // TODO: check approval received
  yield wait(4000)
  // uncomment to dump dbs to screen
  // yield dumpDB({ bot, types })
})

proto.assignEmployee = co(function* ({ user, employee, context }) {
  const application = yield this.getApplicationByContext({ context })
  const allModels = this.productsAPI.models.all
  const assign = employee.send({
    object: buildResource({
      models: allModels,
      model: 'tradle.AssignRelationshipManager',
      resource: {
        employee: buildResource.stub({
          models: allModels,
          resource: employee.identity
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

proto.runThroughApplication = co(function* ({
  user,
  awaitCertificate,
  product,
  relationshipManager
}) {
  const {
    productsAPI,
    employeeManager
  } = this

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

  let assignedEmployee
  let context
  while (true) {
    let message = yield user.awaitMessage()
    let { object } = message
    if (!context) {
      context = message.context
    }

    if (relationshipManager && !assignedEmployee) {
      yield this.assignEmployee({ user, context, employee: relationshipManager })
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

  return this.getApplicationByContext({ context })
})

proto.dumpDB = co(function* ({ types }) {
  const results = yield types.map(type => this.bot.db.search({ type }))
  types.forEach((type, i) => {
    console.log(type)
    console.log(JSON.stringify(results[i].items, null, 2))
  })
})

proto.clear = co(function* () {
  const self = this
  const existingTables = yield this.tradle.aws.dynamodb.listTables().promise()
  const toDelete = existingTables.TableNames
    .filter(name => name.startsWith(this.tradle.prefix))

  const batches = batchify(toDelete, 5)
  yield batches.map(co(function* (batch) {
    yield batch.map(id => {
      return self.destroyTable(id)
    })
  }))
})

proto.destroyTable = co(function* (TableName) {
  while (true) {
    try {
      yield this.tradle.dbUtils.deleteTable({ TableName })
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

proto.getApplicationByContext = function ({ context }) {
  const { bot, productsAPI } = this
  return bot.db.findOne({
    type: productsAPI.models.private.application.id,
    filter: {
      EQ: { context }
    }
  })
}

function createUser ({ tradle, bot, onmessage, name }) {
  // bot.users = require('../../test/mock/users')()
  // bot.keys = botFixture.keys
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
  this.tradle = tradle
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

  tradle.delivery.mqtt.on('message', ({ recipient, message }) => {
    if (recipient === this.permalink) {
      this.emit('message', message)
    }
  })

  this._types = []
  recordTypes(this, this._types)
  this._ready = tradle.identities.addContact(this.identity)
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
  yield this._ready

  this._debug('sending', object[TYPE])
  const message = yield this._createMessage({ object, other })
  yield this.tradle.user.onSentMessage({
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
    host: this.tradle.aws.s3.endpoint,
    // region,
    object,
    bucket: this.tradle.buckets.FileUpload.name,
    keyPrefix: `test-${this.permalink}`
  })

  if (replacements.length) {
    yield replacements.map(({ key, bucket, body, mimetype }) => {
      return this.tradle.s3Utils.put({ key, bucket, value: body, contentType: mimetype })
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

function recordTypes (user, types) {
  return function (message) {
    const type = message.object[TYPE]
    if (type !== 'tradle.Message' && !types.includes(type)) {
      types.push(type)
    }
  }
}

function wrapWithIntercept (fn) {
  return co(function* (...args) {
    const { bot, tradle } = this
    this.interceptor = intercept({
      bot,
      tradle,
      // onmessage: function ({ permalink, messages }) {
      //   if (permalink === employee.permalink) {
      //     debugger
      //     // yield
      //   }
      // }
    })

    try {
      yield fn.apply(this, args)
    } finally {
      this.interceptor.restore()
    }
  })
}

// function createTradleInstance ({ service='tradle', stage='test' }) {
//   let env = clone(defaultTradleInstance.env, {
//     SERVERLESS_SERVICE_NAME: service,
//     SERVERLESS_STAGE: stage,
//     SERVERLESS_PREFIX: `${service}-${stage}-`
//   })

//   env = reprefixServices(env, env.SERVERLESS_PREFIX)
//   return defaultTradleInstance.createInstance(env)
// }

module.exports = {
  createUser,
  createProductsBot,
  Test: E2ETest,
  // endToEndTest: opts => new E2ETest(opts).run(),
  clear: opts => new E2ETest(opts).clear()
}
