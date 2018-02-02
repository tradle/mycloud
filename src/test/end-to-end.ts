require('./env').install()

// @ts-ignore
import Promise = require('bluebird')
import _ = require('lodash')
import IotMessage = require('@tradle/iot-message')
import { EventEmitter } from 'events'
import nock = require('nock')
import assert = require('assert')
import nodeCrypto = require('crypto')
import { TYPE, TYPES, SIG, SEQ } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import validateResource = require('@tradle/validate-resource')
import mergeModels = require('@tradle/merge-models')
import { utils as tradleUtils } from '@tradle/engine'
// import createProductsStrategy = require('@tradle/bot-products')
import createEmployeeManager = require('@tradle/bot-employee-manager')
import { fake as genSample } from '@tradle/gen-samples'
import { replaceDataUrls } from '@tradle/embed'
// const dbUtils = require('../db-utils')
// const Delivery = require('../delivery')
// const { extractAndUploadEmbeds } = require('@tradle/aws-client').utils
import { createTestTradle } from '../'
import { Tradle } from '../tradle'
import { Logger } from '../logger'
import Env from '../env'
import * as onmessage from '../samplebot/lambda/mqtt/onmessage'
import { genLocalResources } from '../cli/utils'
import { utils, crypto } from '../'
// const botFixture = require('./fixtures/bot')
// const userIdentities = require('./fixtures/users-pem')
import intercept = require('./interceptor')
import Errors = require('../errors')
const { createTestProfile } = require('./utils')
const defaultTradleInstance = require('../').tradle
const { MESSAGE } = TYPES

const genIdentity = async (tradle:Tradle) => {
  const { identity, keys } = (await tradle.init.genIdentity()).priv
  return {
    identity,
    keys,
    profile: createTestProfile()
  }
}

// const credentials = (function () {
//   const { credentials } = aws.AWS.config
//   return _.pick(credentials, ['accessKeyId', 'secretAccessKey'])
// }())

const baseModels = require('../models')
const DEFAULT_PRODUCT = 'nl.tradle.DigitalPassport'
const SIMPLE_MESSAGE = 'tradle.SimpleMessage'
const APPLICATION = 'tradle.Application'

export class Test {
  private bot: any
  private tradle: Tradle
  private productsAPI: any
  private employeeManager: any
  private products: string[]
  private _ready: Promise<void>
  private logger: Logger
  private debug: Function
  private interceptor: any
  constructor ({
    tradle=defaultTradleInstance,
    bot,
    productsAPI,
    employeeManager
  }) {
    this.bot = bot
    this.tradle = tradle
    this.productsAPI = productsAPI
    this.employeeManager = employeeManager
    this.products = productsAPI.products.filter(p => p !== 'tradle.EmployeeOnboarding')
    this._ready = this._init()
    this.logger = bot.env.sublogger('e2e')
    this.debug = this.logger.debug
  }

  private _init = async () => {
    await this.tradle.init.ensureInitialized()
    this.bot.identity = await this.bot.getMyIdentity()
    await this.bot.addressBook.addContact(this.bot.identity)
    this.bot.ready()
    this.debug('bot permalink', crypto.getPermalink(this.bot.identity))
  }

  public get models () {
    return this.bot.modelStore.models
  }

  public runEmployeeAndCustomer = wrapWithIntercept(async (opts:any={}) => {
    await this._ready

    const { product=DEFAULT_PRODUCT } = opts
    const { tradle, bot } = this
    const [
      employee,
      customer
    ] = await Promise.all([
      createUser({ bot, tradle, name: 'employee' }),
      createUser({ bot, tradle, name: 'customer' })
    ])

    const employeeApp = await this.onboardEmployee({ user: employee })
    employee.on('message', async (message) => {
      if (message.object[TYPE] === MESSAGE) {
        message = message.object
      } else {
        return
      }

      const hey = {
        [TYPE]: SIMPLE_MESSAGE,
        message: 'hey'
      }

      message = _.cloneDeep(message)
      await bot.objects.resolveEmbeds(message)
      await bot.identities.addAuthorInfo(message)
      await employee.send({
        other: {
          forward: message._author
        },
        object: hey
      })
    })

    return await this.onboardCustomer({
      user: customer,
      relationshipManager: employee,
      product
    })

    // customer.send({
    //   object: {
    //     [TYPE]: 'tradle.ForgetMe',
    //     message: 'please forget me'
    //   }
    // })

    // while (true) {
    //   let received = await customer.awaitMessage()
    //   if (received.object[TYPE] === 'tradle.ForgotMe') break
    // }
  })

  public genIdentity = async () => {
    return await genIdentity(this.tradle)
  }

  public runEmployeeAndFriend = wrapWithIntercept(async () => {
    await this._ready
    const { bot, tradle, productsAPI } = this
    const employee = await createUser({ bot, tradle, name: 'employee' })
    await this.onboardEmployee({ user: employee })

    const { friends } = bot
    const url = 'http://localhost:12345'
    const { identity } = await this.genIdentity()
    const friend = {
      name: 'friendly bank',
      identity,
      url
    }

    await friends.add(friend)
    const hey = {
      [TYPE]: SIMPLE_MESSAGE,
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
        assert.equal(msg.object[TYPE], SIMPLE_MESSAGE)
        assert.deepEqual(_.pick(msg.object, Object.keys(hey)), hey)
        return [
          201
        ]
      })

    await employee.send({
      other: {
        forward: identityPermalink
      },
      object: hey
    })
  })

  public onboardEmployee = async ({ user }) => {
    return await this.runThroughApplication({
      user,
      awaitCertificate: true,
      product: 'tradle.EmployeeOnboarding'
    })
  }

  public onboardCustomer = async ({
    user,
    relationshipManager,
    product
  }: {
    user:User,
    relationshipManager?:User,
    product:string
  }) => {
    const { bot, models } = this

    if (relationshipManager) {
      let context
      relationshipManager.on('message', async (message) => {
        if (message.object.object) message = message.object
        if (message.context) context = message.context

        const payload = message.object

        // pre-signed urls don't work in localstack yet
        // so resolve with root credentials
        // if (payload[TYPE] === 'tradle.PhotoID') {
        //   console.log(payload.scan.url)
        // }

        await bot.objects.resolveEmbeds(payload)
        const type = payload[TYPE]
        const model = models[type]
        if (model.subClassOf === 'tradle.Form') {
          await relationshipManager.send({
            other: { context },
            object: buildResource({
                models,
                model: 'tradle.Verification'
              })
              .set({
                [TYPE]: 'tradle.Verification',
                document: payload,
                dateVerified: Date.now()
              })
              .toJSON()
          })
        }

        if (context) {
          const application = await this.getApplicationByContext({ context })
          if (application.status === 'completed') {
            await this.approve({
              user,
              relationshipManager,
              application,
              context
            })
          }
        }

        // console.log('EMPLOYEE RECEIVED', payload[TYPE])
        // const type = payload[TYPE]
        // if (productsAPI.models.all[type].subClassOf === 'tradle.Form') {
        //   await bot.addressBook.addAuthorInfo(message)
        // }
      })
    }

    const start = Date.now()
    const result = await this.runThroughApplication({
      user,
      relationshipManager,
      product,
      awaitCertificate: true
    })

    const { application, conversation } = result
    const storedConversation = await this.bot.db.find({
      orderBy: {
        property: 'time',
        desc: false
      },
      filter: {
        GT: {
          time: start - 1
        },
        EQ: {
          [TYPE]: 'tradle.Message',
          _counterparty: user.permalink
        }
      }
    })

    // conversation.forEach((item, i) => {
    //   if (!_.isEqual(item, storedConversation.items[i])) {
    //     debugger
    //   }
    // })

    // assert.deepEqual(conversation, storedConversation.items)
    return result
  }

  public approve = function (opts) {
    opts.approve = true
    return this.judge(opts)
  }

  public reject = function (opts) {
    opts.approve = false
    return this.judge(opts)
  }

  public judge = async ({
    relationshipManager,
    user,
    application,
    context,
    approve=true
  }) => {
    const { bot, productsAPI, models } = this
    if (application) {
      context = application.context
    } else {
      application = await this.getApplicationByContext({ context })
    }

    // if (!relationshipManager) return

    const approval = buildResource({
        models,
        model: 'tradle.ApplicationApproval',
      })
      .set({
        application,
        message: 'approved!'
      })
      .toJSON()

    const denial = buildResource({
        models,
        model: 'tradle.ApplicationDenial',
      })
      .set({
        application,
        message: 'denied!'
      })
      .toJSON()

    const judgment = approve ? approval : denial
    await (relationshipManager || bot).send({
      object: judgment,
      other: { context }
    })

    // TODO: check approval received
    await wait(4000)
    // uncomment to dump dbs to screen
    // await dumpDB({ bot, types })
  }

  public assignEmployee = async ({ user, employee, context }) => {
    const application = await this.getApplicationByContext({ context })
    const { models } = this
    const assign = employee.send({
      other: { context },
      object: buildResource({
        models,
        model: 'tradle.AssignRelationshipManager',
        resource: {
          employee: buildResource.stub({
            models,
            resource: employee.identity
          }),
          application: buildResource.stub({
            models,
            resource: application
          })
        }
      }).toJSON()
    })

    const getIntroduced = user.awaitMessage()
    await Promise.all([getIntroduced, assign])
  }

  public runThroughApplication = async ({
    user,
    awaitCertificate,
    product,
    relationshipManager
  }: {
    user: User,
    product:string,
    awaitCertificate?:boolean,
    relationshipManager?:User
  }) => {
    const conversation = []
    const {
      productsAPI,
      employeeManager,
      models
    } = this

    user.sendSelfIntroduction()
    user.on('messages', messages => conversation.push(...messages))
    user.on('send', message => conversation.push(message))

    await user.waitFor(message => {
      const { object } = message
      return object[TYPE] === 'tradle.FormRequest' &&
        object.form !== 'tradle.TermsAndConditions'
    })

    const bizModels = productsAPI.models.biz
    user.send({ object: createProductRequest(product) })

    let assignedEmployee
    let context
    let stop
    while (!stop) {
      let messages = await user.awaitMessages()
      for (let message of messages) {
        let { object } = message
        if (!context) {
          context = message.context
        }

        if (relationshipManager && !assignedEmployee) {
          await this.assignEmployee({ user, context, employee: relationshipManager })
          assignedEmployee = true
        }

        let type = object[TYPE]
        if (type === 'tradle.FormRequest') {
          let form = genSample({
            models,
            model: models[object.form]
          })
          .value

          // if (assignedEmployee) {
          //   await wait(1000)
          // }

          user.send({
            object: form,
            other: { context }
          })

        } else if (models[type].subClassOf === 'tradle.MyProduct') {
          stop = true
        // } else if (type === 'tradle.Message') {
        //   // console.log('..from employee')
        } else if (!awaitCertificate) {
          stop = true
        }
      }
    }

    return {
      application: await this.getApplicationByContext({ context }),
      conversation
    }

    function createProductRequest (product) {
      return buildResource({
          models,
          model: 'tradle.ProductRequest',
        })
        .set({
          requestFor: product,
          contextId: nodeCrypto.randomBytes(32).toString('hex')
        })
        .toJSON()

    }
  }

  public dumpDB = async ({ types }) => {
    const results = await types.map(type => this.bot.db.search({ type }))
    types.forEach((type, i) => {
      console.log(type)
      console.log(JSON.stringify(results[i].items, null, 2))
    })
  }

  public getApplicationByContext = async ({ context }) => {
    const { bot } = this
    return await bot.db.findOne({
      filter: {
        EQ: {
          [TYPE]: APPLICATION,
          context
        }
      }
    })
  }
}

const createUser = async ({
  tradle,
  bot,
  name
}: {
  tradle:Tradle,
  bot:any,
  name?:string
}):Promise<User> => {
  const { identity, keys, profile } = await genIdentity(tradle)
  return new User({
    tradle,
    identity,
    keys,
    bot,
    profile,
    name: name || profile.name.formatted
  })
}

class User extends EventEmitter {
  public name: string
  public identity: any
  public permalink: string
  public clientId: string
  public keys: any
  public profile: any
  public bot: any
  public env: Env
  public userPubKey: any
  public botPubKey: any
  public tradle: Tradle
  public logger: Logger
  public debug: Function
  private _userSeq: number
  private _botSeq: number
  private _ready: Promise
  private _types: string[]
  constructor ({ tradle, identity, keys, profile, name, bot }) {
    super()

    this.tradle = tradle
    this.env = tradle.env
    this.logger = this.env.sublogger('e2e:user')
    this.debug = this.logger.debug
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
      let payload = message
      while (payload.object) {
        types.push(payload.object[TYPE])
        payload = payload.object
      }

      this.debug('received', types.join(' -> '))
      if (payload[TYPE] === 'tradle.FormRequest') {
        if (payload.form === 'tradle.TermsAndConditions') {
          this.debug('accepting T&Cs')
          this.send({
            object: payload.prefill
          })
        }
      }
    })

    tradle.delivery.mqtt.on('messages', ({ recipient, messages }) => {
      if (recipient === this.permalink) {
        this.emit('messages', messages)
      }
    })

    tradle.delivery.mqtt.on('message', ({ recipient, message }) => {
      if (recipient === this.permalink) {
        this.emit('message', message)
      }
    })

    this._types = []
    recordTypes(this, this._types)
    this.debug('permalink', this.permalink)
    this._ready = tradle.identities.addContact(this.identity)
  }

  public get models () {
    return this.bot.modelStore.models
  }

  public awaitType = async (type) => {
    return this.waitFor(message => {
      return message.object[TYPE] === type
    })
  }

  public waitFor = async (filter) => {
    return new Promise(resolve => {
      const handler = (message) => {
        if (filter(message)) {
          this.removeListener('message', handler)
          resolve()
        }
      }

      this.on('message', handler)
    })
  }

  public awaitMessages = function () {
    return new Promise(resolve => this.once('messages', resolve))
  }

  public awaitMessage = function () {
    return new Promise(resolve => this.once('message', resolve))
  }

  public sign = function (object) {
    return this.bot.sign(object, this)
  }

  public send = async ({ object, other }: { object: any, other?: any }) => {
    await this._ready

    this.debug('sending', object[TYPE])
    const message = await this._createMessage({ object, other })
    this.emit('send', message)
    await onmessage.invoke({
      clientId: this.clientId,
      data: await IotMessage.encode({
        type: 'messages',
        payload: [message].map(item => validateResource.utils.omitVirtualDeep(item))
      })
    })

    // await this.tradle.user.onSentMessage({
    //   clientId: this.clientId,
    //   message
    // })

    // return await this.bot.process.message.handler(message)
    // return await this.bot.trigger('message', message)
  }

  public _createMessage = async ({ object, other={} }) => {
    if (!object[SIG]) {
      object = await this.sign(object)
    }

    const unsigned = _.extend({
      [TYPE]: 'tradle.Message',
      [SEQ]: this._userSeq++,
      time: Date.now(),
      recipientPubKey: this.botPubKey,
      object: utils.omitVirtual(object)
    }, other)

    const message = await this.sign(unsigned)
    message.object = object // with virtual props
    const replacements = replaceDataUrls({
      endpoint: this.tradle.aws.s3.endpoint.host,
      // region,
      object,
      bucket: this.tradle.buckets.FileUpload.name,
      keyPrefix: `test-${this.permalink}`
    })

    if (replacements.length) {
      await replacements.map(({ key, bucket, body, mimetype }) => {
        return this.tradle.s3Utils.put({ key, bucket, value: body, headers: { ContentType: mimetype } })
      })

      this.debug('uploaded embedded media')
    }

    await this.bot.save(object)
    // const uploaded = await extractAndUploadEmbeds({
    //   host: s3Host,
    //   object,
    //   credentials,
    //   bucket: buckets.FileUpload.name,
    //   keyPrefix: `test-${this.permalink}`
    // })

    return message //omitVirtualRecursive(message)
  }

  public sendSelfIntroduction = function () {
    const { models, identity, profile } = this
    const selfIntro = buildResource({
      models,
      model: 'tradle.SelfIntroduction',
      resource: {
        identity,
        name: profile.name.formatted
      }
    })
    .toJSON()

    return this.send({ object: selfIntro })
  }
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
  return async function (...args) {
    const { bot, tradle } = this
    this.interceptor = intercept({ bot, tradle })

    try {
      await fn.apply(this, args)
    } finally {
      await wait(2000)
      this.interceptor.restore()
    }
  }
}

// function createTradleInstance ({ service='tradle', stage='test' }) {
//   let env = clone(defaultTradleInstance.env, {
//     SERVERLESS_SERVICE_NAME: service,
//     SERVERLESS_STAGE: stage,
//     SERVERLESS_PREFIX: `${service}-${stage}-`
//   })

//   return defaultTradleInstance.createInstance(env)
// }

const clearBuckets = async ({ tradle }) => {
  await Promise.all(Object.keys(tradle.buckets)
    .filter(id => {
      return id !== 'PublicConf' &&
        id !== 'PrivateConf' &&
        id !== 'Secrets' &&
        id !== 'Objects'
    })
    .map(async (id) => {
      const bucket = tradle.buckets[id]
      try {
        await bucket.clear()
        // await bucket.destroy()
      } catch (err) {
        Errors.ignore(err, {
          code: 'NoSuchBucket'
        })
      }
    }))
}

const clearTables = async ({ tradle }) => {
  const { debug } = tradle.logger
  const clearTable = async (TableName) => {
    while (true) {
      try {
        await tradle.dbUtils.clear(TableName)
        debug(`cleared table: ${TableName}`)
        break
      } catch (err) {
        if (err.name === 'ResourceNotFoundException') {
          break
        }

        if (err.name !== 'LimitExceededException') {
          throw err
        }

        await wait(1000)
      }
    }
  }

  const existingTables = await tradle.dbUtils.listTables(tradle.env)
  const toDelete = existingTables.filter(name => {
    if (!name.startsWith(tradle.prefix)) {
      return false
    }

    name = name.slice(tradle.prefix.length)
    return name !== 'pubkeys'
  })

  debug('clearing tables', toDelete)

  const batches = _.chunk(toDelete, 5)
  await Promise.all(batches.map(async (batch) => {
    await Promise.all(batch.map(clearTable))
    debug('cleared tables', batch)
  }))

  debug('done clearing tables')
}

const clear = async ({ tradle }) => {
  await Promise.all([
    clearTables({ tradle }),
    clearBuckets({ tradle })
  ])
}

export {
  createUser,
  // createProductsBot,
  // endToEndTest: opts => new Test(opts).run(),
  clear
}
