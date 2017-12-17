
import { tradle } from '../../'
import { Lambda, EventSource } from '../../lambda'
import promisify = require('pify')
const zlib = promisify(require('zlib'))

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
  const message = await zlib.gunzip(buf)
  await tradle.user.onSentMessage({ clientId, message })
  lambda.logger.debug('preceived')
})

export const handler = lambda.handler
