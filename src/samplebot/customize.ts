import dotProp = require('dot-prop')
import biz = require('@tradle/biz-plugins')
import customizeMessage = require('@tradle/plugin-customize-message')
import createDeploymentModels from './deployment-models'
import createBankModels from './bank-models'
import createDeploymentHandlers from './deployment-handlers'
import createBaseBot = require('../bot')
import strategies = require('./strategy')
import { createBot } from '../bot'
import { createConf } from './configure'

export async function customize (opts={}) {
  const { bot=createBot(), delayReady } = opts
  const conf = createConf(bot)
  let privateConf = await conf.getPrivateConf()

  const { org, products } = privateConf
  const { plugins={} } = products
  const { onfido={} } = plugins
  const namespace = org.domain.split('.').reverse().join('.')
  const deploymentModels = createDeploymentModels(namespace)
  const DEPLOYMENT = deploymentModels.deployment.id
  const bankModels = createBankModels(namespace)
  const models = { ...deploymentModels.all, ...bankModels }
  const {
    productsAPI,
    employeeManager,
    onfidoPlugin
  } = strategies.products({
    conf,
    onfido,
    bot,
    namespace,
    models,
    products: products.enabled,
    approveAllEmployees: products.approveAllEmployees,
    autoVerify: products.autoVerify,
    autoApprove: products.autoApprove,
    queueSends: products.queueSends
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
      getConf: () => getPluginConf('customize-message'),
      logger: bot.logger
    }))

    if (productsAPI.products.includes(DEPLOYMENT)) {
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

  if (!opts.delayReady) {
    customize().then(() => bot.ready())
  }

  return {
    conf,
    bot,
    productsAPI,
    employeeManager,
    onfidoPlugin
  }
}
