import querystring = require('querystring')
import _ = require('lodash')
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
  AddProvider: (data: any) => `scan this QR code with the Tradle app or open <a href="${getChatLink(data)}">this link</a> on your mobile device to add this provider to your Conversations screen`,
  ApplyForProduct: (data: any) => `scan this QR code with the Tradle app or open <a href="${getChatLink(data)}">this link</a> on your mobile device to add this provider to your Conversations screen, and apply for ${data.product}`,
}

const getChatLink = ({ provider, host, product }) => {
  const query = {
    permalink: provider,
    url: host,
    product
  }

  const qs = querystring.stringify(_.pickBy(query, value => value != null))
  return `https://link.tradle.io/chat?${qs}`
}

const inferSchemaAndData = ({ provider, host, data }) => {
  const { claimId, product } = data
  if (claimId) {
    return {
      schema: 'ImportData',
      data: { provider, host, dataHash: claimId }
    }
  }

  if (product) {
    return {
      schema: 'ApplyForProduct',
      data: { provider, host, product }
    }
  }

  return {
    schema: 'AddProvider',
    data: { provider, host }
  }
}

lambda.use(async (ctx:Koa.Context, next) => {
  const { query={} } = ctx
  let { schema, ...data } = query
  const provider = await getPermalink
  const host = bot.apiBaseUrl
  if (!schema) {
    ({ schema, data } = inferSchemaAndData({ provider, host, data }))
  }

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
