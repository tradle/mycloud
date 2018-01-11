import OnfidoAPI = require('@tradle/onfido-api')
import { Onfido, models as onfidoModels } from '@tradle/plugin-onfido'
import Errors = require('../../errors')

export const createOnfidoPlugin = ({ bot, logger, productsAPI, apiKey }) => {
  const onfidoAPI = new OnfidoAPI({ token: apiKey })
  const onfidoPlugin = new Onfido({
    bot,
    logger,
    products: [{
      product: 'tradle.OnfidoVerification',
      reports: onfidoAPI.mode === 'test'
        ? ['document', 'identity']
        : ['document', 'identity', 'facialsimilarity']
    }],
    productsAPI,
    onfidoAPI,
    padApplicantName: true,
    formsToRequestCorrectionsFor: ['tradle.OnfidoApplicant', 'tradle.Selfie']
  })

  productsAPI.plugins.use(onfidoPlugin)
  return onfidoPlugin
}

export const registerWebhook = async ({ bot, onfidoPlugin }) => {
  const fakeApiGW = require('../../test/fake-service-map')['R_RESTAPI_ApiGateway']
  if (bot.env['R_RESTAPI_ApiGateway'] === fakeApiGW ||
    /^https?:\/\/localhost/.test(bot.apiBaseUrl)) {
    onfidoPlugin.logger.warn(`can't register webhook for localhost. ` +
      `Run: ngrok http ${bot.env.SERVERLESS_OFFLINE_PORT} ` +
      `and set the SERVERLESS_OFFLINE_APIGW environment variable`)

    return
  }

  const url = `${bot.apiBaseUrl}/onfido`
  try {
    const webhook = await onfidoPlugin.getWebhook()
    if (webhook.url === url) return

    await onfidoPlugin.unregisterWebhook({ url: webhook.url })
  } catch (err) {
    Errors.rethrow(err, 'system')
  }

  // ideally get the path from the cloudformation
  onfidoPlugin.logger.info(`registering webhook for url: ${url}`)
  await onfidoPlugin.registerWebhook({ url })
}
