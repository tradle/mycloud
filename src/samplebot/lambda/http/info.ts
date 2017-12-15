import Router = require('koa-router')
import cors = require('kcors')
import { createConf } from '../../configure'
import { createBot } from '../../../bot'
import { EventSource } from '../../../lambda'

const bot = createBot()
const lambda = bot.lambdas.info()
const { logger } = lambda
const conf = createConf({ bot })
const router = new Router()
router.get('/info', async (ctx, next) => {
  const result = await conf.info.get()
  if (!ctx.body) ctx.body = {}
  Object.assign(ctx.body, result)
})

lambda.use(cors())
lambda.use(router.routes())

bot.ready()

export const handler = lambda.handler
