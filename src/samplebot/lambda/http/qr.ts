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
  const { claimId } = queryParams
  const provider = await getPermalink
  const host = bot.apiBaseUrl
  const dataUrl = await createDataURL({
    schema: claimId ? 'ImportData' : 'AddProvider',
    data: { provider, host, dataHash: claimId }
  })

  ctx.body = `<html><img src="${dataUrl}" width="300" height="300" /></html>`
})

export const handler = lambda.handler
