import bodyParser = require('body-parser')
import cors = require('cors')
import helmet = require('helmet')
import coexpress = require('co-express')
import Tradle from '../tradle'

export = function attachHandler ({ tradle, router }: {
  tradle:Tradle,
  router:any
}) {
  const { init, user, logger } = tradle
  router.use(cors())
  router.use(helmet())
  router.use(bodyParser.json({ limit: '10mb' }))
  // router.use(bodyParser.urlencoded({ limit: '10mb', extended: true }))
  router.post('/auth', coexpress(function* (req, res) {
    // debug('[START] /auth', Date.now())
    const event = req.body
    // TODO: use @tradle/validate-resource
    const result = yield user.onSentChallengeResponse(req.body)
    res.json(result)
  }))
}
