import _ = require('lodash')
import { createConf } from '../../configure'
import { createBot } from '../../../bot'
import { createLambda } from '../../../samplebot/middleware/deployment-pingback'

const bot = createBot()
const lambda = createLambda({ bot })
export const handler = lambda.handler
