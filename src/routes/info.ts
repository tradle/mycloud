import coexpress = require('co-express')
import cors = require('cors')
import helmet = require('helmet')
import Tradle from '../tradle'
import { timestamp } from '../utils'

export = function attachHandler ({ tradle, router }: {
  tradle:Tradle,
  router:any
}) {
  const { init, user, logger } = tradle
  router.use(cors())
  router.use(helmet())
  router.get('/info', coexpress(function* (req, res) {
    logger.debug('[START] /info', timestamp())
    yield init.ensureInitialized()
    logger.debug('initialized')
    const result = yield user.onGetInfo()
    logger.debug('got result')
    res.json(result)
  }))
}
