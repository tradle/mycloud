import QR from '@tradle/qr'
import promisify from 'pify'
import { fromHTTP } from '../../../lambda'
import { Bot, IDeepLink, IApplyForProductDeepLink, IImportDataDeepLink } from '../../types'
import { GET_QR } from '../../lambda-events'

const createDataURL = promisify(QR.toDataURL)

const lambda = fromHTTP({ event: GET_QR, createBot: true })
const descriptions = {
  ImportData: (bot: Bot, data: IImportDataDeepLink) => `scan this QR code with the Tradle app to claim the bundle with claimId: ${data.dataHash}`,
  AddProvider: (bot: Bot, data: IDeepLink) => `scan this QR code with the Tradle app or open <a href="${bot.appLinks.getChatLink(data)}">this link</a> on your mobile device to add this provider to your Conversations screen`,
  ApplyForProduct: (bot: Bot, data: IApplyForProductDeepLink) => `scan this QR code with the Tradle app or open <a href="${bot.appLinks.getApplyForProductLink(data)}">this link</a> on your mobile device to add this provider to your Conversations screen, and apply for ${data.product}`,
}

lambda.use(async (ctx, next) => {
  const { query={}, components } = ctx
  const { bot } = components
  let { schema, ...data } = query
  const provider = await bot.getPermalink()
  const host = bot.apiBaseUrl
  if (!schema) {
    ({ schema, data } = bot.appLinks.inferSchemaAndData({ provider, host, data }))
  }

  if (!data.platform) data.platform = 'mobile'

  const dataUrl = await createDataURL({ schema, data })
  const description = descriptions[schema](bot, data)

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
