import OnfidoAPI = require('@tradle/onfido-api')
import { Onfido, models as onfidoModels } from '@tradle/plugin-onfido'

export const createOnfidoPlugin = ({ bot, productsAPI, apiKey }) => {
  const onfidoAPI = new OnfidoAPI({ token: apiKey })
  const logger = bot.logger.sub('onfido')
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

  ;(async () => {
    try {
      await onfidoPlugin.getWebhook()
    } catch (err) {
      // ideally get the path from the cloudformation
      const { apiGateway } = bot.resources
      if (/^https?:\/\/localhost/.test(apiGateway)) {
        logger.warn(`can't register webhook for localhost. ` +
          `Run: ngrok http ${bot.env.SERVERLESS_OFFLINE_PORT} ` +
          `and set the SERVERLESS_OFFLINE_APIGW environment variable`)

        return
      }

      const url = `${bot.resources.apiGateway}/onfido`
      logger.info(`registering webhook for url: ${url}`)
      await onfidoPlugin.registerWebhook({ url })
    }
  })()

  productsAPI.plugins.use(onfidoPlugin)
  return onfidoPlugin
}
