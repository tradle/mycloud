import coexpress = require('co-express')
import cors = require('cors')
import helmet = require('helmet')
import { timestamp } from '../utils'
import { createTradle } from '../../../'
import { createConf } from '../../configure'

const tradle = createTradle()
const { router } = tradle
const conf = createConf({ tradle })
router.use(cors())
router.use(helmet())
router.get('/info', coexpress(function* (req, res) {
  const result = yield conf.publicConf.get()
  result.aws = true
  result.iotParentTopic = tradle.env.IOT_PARENT_TOPIC
  res.json(result)
}))

router.use(router.defaultErrorHandler)
export const handler = tradle.createHttpHandler()
