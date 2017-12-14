import { tradle } from '../../'
import { Lambda, EventSource } from '../../lambda'

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

  const message = new Buffer(data.data, 'base64')
  await tradle.user.onSentMessage({ clientId, message })
  lambda.logger.debug('preceived')
})

export const handler = lambda.handler
