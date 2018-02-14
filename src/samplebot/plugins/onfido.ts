import OnfidoAPI = require('@tradle/onfido-api')
import { Onfido, models as onfidoModels } from '@tradle/plugin-onfido'
import Errors = require('../../errors')
import { Bot, IPluginOpts } from '../types'

// const TEST_APIGW = require('../../test/fixtures/fake-service-map')['R_RESTAPI_ApiGateway']

export const createPlugin = ({ bot, logger, productsAPI, conf }: IPluginOpts) => {
  const { apiKey } = conf
  const onfidoAPI = new OnfidoAPI({ token: apiKey })
  const plugin = new Onfido({
    bot,
    logger,
    products: [{
      product: 'tradle.onfido.CustomerVerification',
      reports: onfidoAPI.mode === 'test'
        ? ['document', 'identity']
        : ['document', 'identity', 'facialsimilarity']
    }],
    productsAPI,
    onfidoAPI,
    padApplicantName: true,
    formsToRequestCorrectionsFor: ['tradle.onfido.Applicant', 'tradle.Selfie']
  })

  // currently the api and plugin are the same thing
  return {
    plugin,
    onfido: plugin
  }
}

export const registerWebhook = async ({ bot, onfido }: { bot: Bot, onfido: Onfido }) => {
  const ret = {
    created: false,
    webhook: null
  }

  // if (bot.apiBaseUrl.includes(TEST_APIGW) ||
  if (bot.isTesting ||
    /^https?:\/\/localhost/.test(bot.apiBaseUrl)) {
    onfido.logger.warn(`can't register webhook for localhost. ` +
      `Run: ngrok http ${bot.env.SERVERLESS_OFFLINE_PORT} ` +
      `and set the SERVERLESS_OFFLINE_APIGW environment variable`)

    return ret
  }

  const url = `${bot.apiBaseUrl}/onfido`
  try {
    const webhook = await onfido.getWebhook()
    if (webhook.url === url) {
      ret.webhook = webhook
      return ret
    }

    await onfido.unregisterWebhook({ url: webhook.url })
  } catch (err) {
    Errors.rethrow(err, 'system')
  }

  // ideally get the path from the cloudformation
  onfido.logger.info(`registering webhook for url: ${url}`)
  ret.webhook = await onfido.registerWebhook({ url })
  ret.created = true
  return ret
}

export { Onfido }
