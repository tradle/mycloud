const path = require('path')
const sinon = require('sinon')
const serverlessYaml = require('../lib/cli/serverless-yml')
const { aws, utils, env } = require('../')
const { SERVERLESS_PREFIX } = env
const { co, pick, extend, promisify } = require('../lib/utils')
const Delivery = require('../lib/delivery')
const Auth = require('../lib/auth')
const createBot = require('../lib/bot')

module.exports = function ({ bot }) {
  const sandbox = sinon.sandbox.create()
  const lambdas = createBot.lambdas(bot)

  sandbox.stub(Auth, 'getLiveSessionByPermalink').callsFake(co(function* (recipient) {
    return {
      permalink: recipient
    }
  }))

  sandbox.stub(Delivery, 'deliverBatch').callsFake(co(function* ({ permalink, messages }) {
    // for (const message of messages) {
    //   yield onmessage(permalink, message)
    // }

    Delivery.emit('messages', { permalink, messages })
    for (const message of messages) {
      Delivery.emit('message', { permalink, message })
    }
  }))

  sandbox.stub(Delivery, 'ack').callsFake(co(function* (...args) {
    Delivery.emit('ack', ...args)
  }))

  sandbox.stub(Delivery, 'reject').callsFake(co(function* (...args) {
    Delivery.emit('reject', ...args)
  }))

  sandbox.stub(aws.lambda, 'invoke').callsFake(function ({
    InvocationType,
    FunctionName,
    Payload
  }) {
    Payload = JSON.parse(Payload)
    const name = FunctionName.slice(SERVERLESS_PREFIX.length)
    const conf = serverlessYaml.functions[name]
    const { handler } = conf
    const [file, handleName] = handler.split('.')
    const lambdaHandler = lambdas[handleName]
    // const module = require(path.resolve(__dirname, '../../', file))
    const exec = promisify(lambdaHandler)
    const promise = exec(Payload, {}).then(
      () => {
        return { StatusCode: 200 }
      },
      err => {
        return { StatusCode: 400, Payload: err.stack }
      }
    )

    return {
      promise: () => promise
    }
  })

  return sandbox
}
