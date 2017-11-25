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
  const messageHandler = coexpress(function* (req, res) {
    const event = req.body
    const { message } = event
    // the user sent us a message
    const result = yield user.onSentMessage({ message })
    if (result) {
      res.json(result)
    } else {
      res.send(200)
    }

    // debug('preceived')
  })

  router.use(cors())
  router.use(helmet())
  router.use(bodyParser.json({ limit: '10mb' }))
  // router.use(bodyParser.urlencoded({ limit: '10mb', extended: true }))
  router.post('/message', messageHandler)
  router.put('/message', messageHandler)
}
