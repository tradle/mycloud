import { prettify } from '../../string-utils'
import { tradle } from '../../'
import { Lambda, EventSource } from '../../lambda'

const lambda = new Lambda({
  source: EventSource.IOT,
  tradle
})

lambda.use(async ({ event, context }) => {
  if (Buffer.isBuffer(event)) event = JSON.parse(event)

  lambda.logger.debug('client disconnected', prettify(event))
  const { clientId } = event
  await tradle.user.onDisconnected({ clientId })
})

export const handler = lambda.handler
