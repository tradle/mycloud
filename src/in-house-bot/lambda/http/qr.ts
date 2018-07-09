import _ from 'lodash'
import QR from '@tradle/qr'
import promisify from 'pify'
import * as Koa from 'koa'
import { createBot } from '../../../'
import { EventSource, fromHTTP } from '../../../lambda'
import { IDeepLink, IApplyForProductDeepLink, IImportDataDeepLink } from '../../types'

const createDataURL = promisify(QR.toDataURL)
const bot = createBot({ ready: false })
const getPermalink = bot.getPermalink()
getPermalink.then(() => bot.ready())

const lambda = fromHTTP({ bot })
const descriptions = {
  ImportData: (data: IImportDataDeepLink) => `scan this QR code with the Tradle app to claim the bundle with claimId: ${data.dataHash}`,
  AddProvider: (data: IDeepLink) => `scan this QR code with the Tradle app or open <a href="${bot.appLinks.getChatLink(data)}">this link</a> on your mobile device to add this provider to your Conversations screen`,
  ApplyForProduct: (data: IApplyForProductDeepLink) => `scan this QR code with the Tradle app or open <a href="${bot.appLinks.getApplyForProductLink(data)}">this link</a> on your mobile device to add this provider to your Conversations screen, and apply for ${data.product}`,
}

lambda.use(async (ctx, next) => {
  const { query={} } = ctx
  let { schema, ...data } = query
  const provider = await getPermalink
  const host = bot.apiBaseUrl
  if (!schema) {
    ({ schema, data } = bot.appLinks.inferSchemaAndData({ provider, host, data }))
  }

  if (!data.platform) data.platform = 'mobile'

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
