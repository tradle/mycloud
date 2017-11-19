import yn = require('yn')
import biz = require('@tradle/biz-plugins')
import createDeploymentModels from './deployment-models'
import createBankModels from './bank-models'
import createDeploymentHandlers from './deployment-handlers'
import sampleQueries from './sample-queries'
import createBot = require('../bot')
import strategies = require('./strategy')
import { tradle } from '../'
import DEFAULT_CONF = require('./default-conf')

export default function createBotFromEnv (env) {
  const {
    PRODUCTS,
    ORG_DOMAIN,
    AUTO_VERIFY_FORMS,
    AUTO_APPROVE_APPS,
    AUTO_APPROVE_EMPLOYEES,
    GRAPHQL_AUTH,
    IS_LOCAL
  } = env

  // important: don't set all props from env
  // as in testing mode it overrides resources like R_BUCKET_...
  tradle.env.set({
    PRODUCTS,
    ORG_DOMAIN,
    AUTO_VERIFY_FORMS,
    AUTO_APPROVE_APPS,
    AUTO_APPROVE_EMPLOYEES,
    GRAPHQL_AUTH,
    IS_LOCAL
  })

  const NAMESPACE = ORG_DOMAIN.split('.').reverse().join('.')
  const deploymentModels = createDeploymentModels(NAMESPACE)
  const DEPLOYMENT = deploymentModels.deployment.id
  const bankModels = createBankModels(NAMESPACE)
  const models = { ...deploymentModels.all, ...bankModels }
  const products = PRODUCTS.split(',').map(id => id.trim())
  const {
    bot,
    productsAPI,
    employeeManager,
    onfidoPlugin
  } = strategies.products({
    tradle,
    namespace: NAMESPACE,
    models,
    products,
    approveAllEmployees: yn(AUTO_APPROVE_EMPLOYEES),
    autoVerify: yn(AUTO_VERIFY_FORMS),
    autoApprove: yn(AUTO_APPROVE_APPS),
    graphqlRequiresAuth: yn(GRAPHQL_AUTH)
  })

  const confBucket = bot.resources.buckets.PublicConf
  const CONF_FILE = 'bot-conf.json'
  const putConf = (conf) => confBucket.put(CONF_FILE, conf)
  const cacheableConf = confBucket.getCacheable({
    key: CONF_FILE,
    ttl: 60000,
    parse: JSON.parse.bind(JSON)
  })

  const getConf = async () => {
    try {
      return await cacheableConf.get()
    } catch (err) {
      return DEFAULT_CONF
    }
  }

  const ensureConfStored = async () => {
    try {
      return await cacheableConf.get()
    } catch (err) {
      return await putConf(DEFAULT_CONF)
    }
  }

  const getPluginConf = async (pluginName) => {
    const conf = await getConf()
    const { plugins={} } = conf
    return plugins[pluginName]
  }

  const customize = async () => {
    const customizeMessage = require('@tradle/plugin-customize-message')
    productsAPI.plugins.use(customizeMessage({
      get models () {
        return productsAPI.models.all
      },
      getConf: () => getPluginConf('customize-message'),
      logger: bot.logger
    }))

    if (products.includes(DEPLOYMENT)) {
      // productsAPI.plugins.clear('onFormsCollected')
      productsAPI.plugins.use(createDeploymentHandlers({ bot, deploymentModels }))
    }

    // const biz = require('@tradle/biz-plugins')
    // unshift
    biz.forEach(plugin => productsAPI.plugins.use(plugin({
      bot,
      productsAPI,
      get models () {
        return productsAPI.models.all
      }
    }), true))
  }

  if (bot.graphqlAPI) {
    bot.graphqlAPI.setGraphiqlOptions({
      logo: {
        src: 'https://blog.tradle.io/content/images/2016/08/256x-no-text-1.png',
        width: 32,
        height: 32
      },
      bookmarks: {
        // not supported
        // autorun: true,
        title: 'Samples',
        items: sampleQueries
      }
    })
  }

  customize().then(() => bot.ready())

  const lambdas = !IS_LOCAL && createBot.lambdas(bot)
  return {
    tradle,
    bot,
    lambdas,
    productsAPI,
    employeeManager,
    onfidoPlugin
  }
}
