// @ts-ignore
import Promise = require('bluebird')
import { EventSource } from '../../lambda'
import { Conf, createConf } from '../configure'
import { createBot } from '../../bot'

const bot = createBot()
const lambda = bot.createLambda({ source: EventSource.LAMBDA })
const conf = createConf({ bot })

lambda.use(async (ctx) => {
  const { style, botConf, models, terms } = ctx.event
  const promises = []
  if (style) {
    promises.push(conf.setStyle(style))
  }

  if (botConf) {
    promises.push(conf.setBotConf(botConf))
  }

  if (models) {
    promises.push(conf.saveModelsPack(models))
  }

  if (terms) {
    promises.push(conf.setTermsAndConditions(terms))
  }

  await Promise.all(promises)
  await conf.recalcPublicInfo()
  await conf.forceReinitializeContainers()
})

export const handler = lambda.handler
