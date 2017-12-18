
import IotMessage = require('@tradle/iot-message')
import { tradle } from '../../'
import { Lambda, EventSource } from '../../lambda'
import Errors = require('../../errors')

const lambda = new Lambda({
  source: EventSource.IOT,
  tradle
})

lambda.use(async ({ event, context }) => {
  let { topic, clientId, data } = event
  if (!clientId && lambda.isUsingServerlessOffline) {
    // serverless-offline support
    clientId = topic.match(/\/([^/]+)\/[^/]+/)[1]
  }

  const buf = typeof data === 'string' ? new Buffer(data, 'base64') : data
  let message
  try {
    message = await IotMessage.decode(buf)
  } catch (err) {
    throw new Errors.InvalidInput('client sent invalid MQTT payload')
  }

  await tradle.user.onSentMessage({ clientId, message })
  lambda.logger.debug('preceived')
})

export const handler = lambda.handler
