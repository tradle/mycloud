import OnfidoAPI from '@tradle/onfido-api'
import { Onfido, models as onfidoModels } from '@tradle/plugin-onfido'
import Errors from '../../errors'
import { Bot, CreatePlugin, IPBReq, Conf } from '../types'
import { isLocalUrl } from '../../utils'

let TEST_APIGW
try {
  TEST_APIGW = require('../../test/fixtures/fake-service-map')['R_RESTAPI_ApiGateway']
} catch (err) {
  // unavailable in prod
}

const DEFAULT_PRODUCTS = [
  'tradle.onfido.CustomerVerification'
]

const REPORTS = ['identity', 'facialsimilarity', 'document']

const normalizePluginConf = conf => ({
  ...conf,
  products: (conf.products || DEFAULT_PRODUCTS).map(pConf => {
    return typeof pConf === 'string' ? { product: pConf } : pConf
  })
})

export const name = 'onfido'

export const createPlugin:CreatePlugin<Onfido> = ({ bot, productsAPI, applications }, { logger, conf }) => {
  const {
    apiKey,
    products
  } = normalizePluginConf(conf)

  const onfidoAPI = new OnfidoAPI({ token: apiKey })
  const plugin = new Onfido({
    bot,
    logger,
    products: products.map(({ product, reports }) => {
      if (!reports) {
        reports = onfidoAPI.mode === 'test'
          ? ['document', 'identity']
          : ['document', 'identity', 'facialsimilarity']
      }

      return { product, reports }
    }),
    productsAPI,
    applications,
    onfidoAPI,
    padApplicantName: true,
    formsToRequestCorrectionsFor: ['tradle.onfido.Applicant', 'tradle.Selfie']
  })

  // currently the api and plugin are the same thing
  const proxy = {
    ['onmessage:tradle.Form']: async (req:IPBReq) => {
      if (!req.skipChecks) {
        return await plugin['onmessage:tradle.Form'](req)
      }
    }
  }

  return {
    plugin: proxy,
    api: plugin
  }
}

export const updateConfiguration = async ({ bot, conf, pluginConf }: {
  bot: Bot
  conf: Conf
  pluginConf: any
}) => {
  const onfidoAPI = new OnfidoAPI({ token: pluginConf.apiKey })
  const onfido = new Onfido({
    bot,
    logger: bot.logger.sub('plugin:onfido'),
    onfidoAPI,
    products: []
  })

  await registerWebhook({ bot, onfido })
}

export const registerWebhook = async ({ bot, onfido }: { bot: Bot, onfido: Onfido }) => {
  const ret = {
    created: false,
    webhook: null
  }

  if (bot.isTesting) {
    if (bot.apiBaseUrl.includes(TEST_APIGW) || isLocalUrl(bot.apiBaseUrl)) {
      onfido.logger.warn(`can't register webhook for localhost.
  Run: ngrok http <port>
  and set the SERVERLESS_OFFLINE_APIGW environment variable`)

      return ret
    }
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
  pluginConf = normalizePluginConf(pluginConf)
  const { models } = conf.bot
  const { apiKey, products=[] } = pluginConf
  if (!apiKey) throw new Error('expected "apiKey"')

  // crap. This is duplication of onfido plugin's job
  products.forEach(({ product, reports }) => {
    const model = models[product]
    if (!model) throw new Error(`missing product model: ${product}`)
    if (model.subClassOf !== 'tradle.FinancialProduct') {
      throw new Error(`"${product}" is not subClassOf tradle.FinancialProduct`)
    }

    if (!Array.isArray(reports)) {
      throw new Error('expected array of Onfido reports')
    }

    reports.forEach(report => {
      if (!REPORTS.includes(report)) {
        throw new Error(`invalid report ${report}. Valid reports are: ${REPORTS.join(', ')}`)
      }
    })
  })
}
