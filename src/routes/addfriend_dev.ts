import bodyParser = require('body-parser')
import cors = require('cors')
import helmet = require('helmet')
import coexpress = require('co-express')
import Tradle from '../tradle'
import { handler } from '../lambda/add-friend'
import { promisify } from '../utils'

export = function attachHandler ({ tradle, router }: {
  tradle:Tradle,
  router:any
}) {
  router.use(cors())
  router.use(helmet())
  router.use(bodyParser.json({ limit: '10mb' }))
  // router.use(bodyParser.urlencoded({ limit: '10mb', extended: true }))
  router.post('/addfriend', coexpress(function* (req, res) {
    const result = yield promisify(handler)(req.body, env.context)
    if (result && typeof result === 'object') {
      res.json(result)
    } else {
      res.end()
    }
  }))
}
