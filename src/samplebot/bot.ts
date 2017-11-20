import dotProp = require('dot-prop')
import biz = require('@tradle/biz-plugins')
import customizeMessage = require('@tradle/plugin-customize-message')
import createDeploymentModels from './deployment-models'
import createBankModels from './bank-models'
import createDeploymentHandlers from './deployment-handlers'
import createBaseBot = require('../bot')
import strategies = require('./strategy')
import { createTradle } from '../'
import { createConf } from './conf'

export async function createBot (tradle=createTradle()) {
  const {
    // PRODUCTS,
    // ORG_DOMAIN,
    // ORG_LOGO,
    // ORG_NAME,
    // AUTO_VERIFY_FORMS,
    // AUTO_APPROVE_APPS,
    // AUTO_APPROVE_EMPLOYEES,
    // GRAPHQL_AUTH,
    IS_LOCAL
  } = tradle.env

  const conf = createConf({ tradle })
  let privateConf = await conf.getPrivateConf()

  const { org } = privateConf
  const products = privateConf.products.enabled
  const namespace = org.domain.split('.').reverse().join('.')
  const deploymentModels = createDeploymentModels(namespace)
  const DEPLOYMENT = deploymentModels.deployment.id
  const bankModels = createBankModels(namespace)
  const models = { ...deploymentModels.all, ...bankModels }
  const {
    bot,
    productsAPI,
    employeeManager,
    onfidoPlugin
  } = strategies.products({
    conf,
    tradle,
    namespace,
    models,
    products,
    approveAllEmployees: products.approveAllEmployees,
    autoVerify: products.autoVerify,
    autoApprove: products.autoApprove,
    // graphqlRequiresAuth: yn(GRAPHQL_AUTH)
  })

  const getPluginConf = async (pluginName) => {
    privateConf = await conf.getPrivateConf()
    const { plugins={} } = privateConf
    return plugins[pluginName]
  }

  const customize = async () => {
    productsAPI.plugins.use(customizeMessage({
      get models () {
        return productsAPI.models.all
      },
      getConf: () => dotProp.get(privateConf, 'plugins.customize-message'),
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

  customize().then(() => bot.ready())

  const lambdas = createBaseBot.lambdas(bot)
  return {
    conf,
    tradle,
    bot,
    lambdas,
    productsAPI,
    employeeManager,
    onfidoPlugin
  }
}
