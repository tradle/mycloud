import OnfidoAPI = require('@tradle/onfido-api')
import { Onfido, models as onfidoModels } from '@tradle/plugin-onfido'
import Errors = require('../../errors')
import { Bot, IPluginOpts, Conf } from '../types'

// const TEST_APIGW = require('../../test/fixtures/fake-service-map')['R_RESTAPI_ApiGateway']

const DEFAULT_PRODUCTS = [
  'tradle.onfido.CustomerVerification'
]

export const createPlugin = ({ bot, logger, productsAPI, conf }: IPluginOpts) => {
  const {
    apiKey,
    products=DEFAULT_PRODUCTS
  } = conf

  const onfidoAPI = new OnfidoAPI({ token: apiKey })
  const plugin = new Onfido({
    bot,
    logger,
    products: products.map(product => ({
      product,
      reports: onfidoAPI.mode === 'test'
        ? ['document', 'identity']
        : ['document', 'identity', 'facialsimilarity']
    })),
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

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: any
}) => {
  const { models } = conf.bot
  const { apiKey, products=[] } = pluginConf
  if (!apiKey) throw new Error('expected "apiKey"')

  products.forEach(product => {
    const model = models[product]
    if (!model) throw new Error(`missing product model: ${product}`)
    if (model.subClassOf !== 'tradle.FinancialProduct') {
      throw new Error(`"${product}" is not subClassOf tradle.FinancialProduct`)
    }
  })
}
