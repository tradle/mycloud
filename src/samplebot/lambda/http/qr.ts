import QR = require('@tradle/qr')
import promisify = require('pify')
import { createBot } from '../../../bot'
import { EventSource } from '../../../lambda'

const createDataURL = promisify(QR.toDataURL)
const bot = createBot()
const lambda = bot.createLambda({ source: EventSource.HTTP })
const getPermalink = bot.getMyIdentityPermalink()
lambda.use(async (ctx, next) => {
  const { queryParams = {} } = ctx.event
  const { dataHash } = queryParams
  const provider = await getPermalink
  const host = bot.apiBaseUrl
  const dataUrl = await createDataURL({
    schema: dataHash ? 'ImportData' : 'AddProvider',
    data: { provider, host, dataHash }
  })

  ctx.body = `<html><img src="${dataUrl}" width="300" height="300" /></html>`
})

export const handler = lambda.handler
