import express = require('express')
import coexpress = require('co-express')
import cors = require('cors')
import helmet = require('helmet')
import { createBot } from '../../../bot'
import { customize } from '../../customize'

const bot = createBot()
const promiseCustom = customize({ bot })

const onfidoRouter = express.Router()
onfidoRouter.use(cors())
onfidoRouter.use(helmet())
onfidoRouter.get('/', coexpress(function* (req, res) {
  const { onfidoPlugin } = yield promiseCustom
  yield onfidoPlugin.processWebhookEvent({ req, res })
}))

const { router } = bot
onfidoRouter.use(router.defaultErrorHandler)
router.use('/onfido', onfidoRouter)

export const handler = bot.createHttpHandler()
