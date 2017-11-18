import bodyParser = require('body-parser')
import cors = require('cors')
import helmet = require('helmet')
import coexpress = require('co-express')
import Tradle from '../tradle'
import { getRequestIps } from '../utils'

export = function attachHandler ({ tradle, router }: {
  tradle:Tradle,
  router:any
}) {
  const { init, user, logger } = tradle
  router.use(cors())
  router.use(helmet())
  router.use(bodyParser.json({ limit: '10mb' }))
  // router.use(bodyParser.urlencoded({ limit: '10mb', extended: true }))
  router.post('/preauth', coexpress(function* (req, res) {
    yield init.ensureInitialized()

    // debug('[START]', now)
    const ips = getRequestIps(req)
    const { clientId, identity } = req.body
    const { accountId } = req.event.requestContext
    const session = yield user.onPreAuth({ accountId, clientId, identity, ips })
    res.json(session)
  }))
}
