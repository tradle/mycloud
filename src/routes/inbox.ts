import bodyParser = require('body-parser')
import cors = require('cors')
import helmet = require('helmet')
import coexpress = require('co-express')
import Tradle from '../tradle'

export = function attachHandler ({ tradle, router }: {
  tradle:Tradle,
  router:any
}) {
  const { user, logger } = tradle
  const inboxHandler = coexpress(function* (req, res) {
    const { messages } = req.body
    logger.debug(`receiving ${messages.length} messages in inbox`)
    for (const message of messages) {
      try {
        yield user.onSentMessage({ message })
      } catch (err) {
        if (err instanceof Errors.Duplicate) {
          logger.debug('received duplicate')
          continue
        }

        throw err
      }
    }

    logger.debug(`received ${messages.length} messages in inbox`)
    // i don't think API Gateway likes non-json responses
    // it lets them through but Content-Type ends up as application/json
    // and clients fail on trying to parse an empty string as json
    res.json({})
  })

  router.use(cors())
  router.use(helmet())
  router.use(bodyParser.json({ limit: '10mb' }))
  // router.use(bodyParser.urlencoded({ limit: '10mb', extended: true }))
  router.put('/inbox', inboxHandler)
  router.post('/inbox', inboxHandler)
}
