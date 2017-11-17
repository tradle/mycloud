import coexpress = require('co-express')
import Tradle from '../tradle'
import { timestamp } from '../utils'

export = function attachHandler ({ tradle, router }: {
  tradle:Tradle,
  router:any
}) {
  const { init, user, logger } = tradle
  router.get('/info', coexpress(function* (req, res) {
    logger.debug('[START] /info', timestamp())
    yield init.ensureInitialized()
    const result = yield user.onGetInfo()
    res.json(result)
  }))
}
