import querystring = require('querystring')
import QR = require('@tradle/qr')
import promisify = require('pify')
import * as Koa from 'koa'
import { createBot } from '../../../bot'
import { EventSource } from '../../../lambda'

const createDataURL = promisify(QR.toDataURL)
const bot = createBot({ ready: false })
const getPermalink = bot.getMyIdentityPermalink()
getPermalink.then(() => bot.ready())

const lambda = bot.createLambda({ source: EventSource.HTTP })
const descriptions = {
  ImportData: ({ dataHash }: any) => `scan this QR code with the Tradle app to claim the bundle with claimId: ${dataHash}`,
  AddProvider: (data: any) => `scan this QR code with the Tradle app or open <a href="${getChatLink(data)}">this link</a> on your mobile device to add this provider to your Conversations screen`
}

const getChatLink = ({ provider, host }) => {
  const qs = querystring.stringify({
    permalink: provider,
    url: host
  })

  return `https://link.tradle.io/chat?${qs}`
}

lambda.use(async (ctx:Koa.Context, next) => {
  const { query={} } = ctx
  const { claimId } = query
  const provider = await getPermalink
  const host = bot.apiBaseUrl
  const schema = claimId ? 'ImportData' : 'AddProvider'
  const data = { provider, host, dataHash: claimId }
  const dataUrl = await createDataURL({ schema, data })
  const description = descriptions[schema](data)

  ctx.body = `
<html>
  <body>
    <h1>Type: ${schema}</h1>
    <p>${description}</p>
    <img src="${dataUrl}" width="300" height="300" />
  </body>
</html>`
})

export const handler = lambda.handler
