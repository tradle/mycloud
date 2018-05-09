import path from 'path'
import _ from 'lodash'
import sinon from 'sinon'
import serverlessYml from '../cli/serverless-yml'
import { promisify } from '../utils'

interface Sandbox extends sinon.SinonSandbox {
  httpOnly?: (permalink:string) => void
}

export = function ({ bot }) {
  const { env, delivery, auth, aws, prefix } = bot
  const { mqtt } = delivery
  const sandbox:Sandbox = sinon.sandbox.create()
  // const lambdas = createBot.lambdas(bot)
  const noMQTT = {}

  sandbox.stub(auth, 'getLiveSessionByPermalink').callsFake(async (recipient) => {
    return {
      clientId: noMQTT[recipient] ? null : 'fakeclientid',
      permalink: recipient
    }
  })

  sandbox.httpOnly = function (permalink) {
    noMQTT[permalink] = true
  }

  sandbox.stub(mqtt, 'deliverBatch').callsFake(async ({ recipient, messages }) => {
    // for (const message of messages) {
    //   yield onmessage(permalink, message)
    // }

    mqtt.emit('messages', { recipient, messages })
    for (const message of messages) {
      mqtt.emit('message', { recipient, message })
    }
  })

  sandbox.stub(mqtt, 'ack').callsFake(async (...args) => {
    mqtt.emit('ack', ...args)
  })

  sandbox.stub(mqtt, 'reject').callsFake(async (...args) => {
    mqtt.emit('reject', ...args)
  })

  sandbox.stub(aws.lambda, 'invoke').callsFake(function ({
    InvocationType,
    FunctionName,
    Payload
  }) {
    Payload = JSON.parse(Payload)
    const name = FunctionName.slice(prefix.length)
    const conf = serverlessYml.functions[name]
    const { handler } = conf
    const [file, handleName] = handler.split('.')
    // const lambdaHandler = lambdas[handleName]
    const module = require(path.resolve(__dirname, '../../', file))
    const lambdaHandler = module[handleName]
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
