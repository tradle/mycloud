import _ from 'lodash'
import validateResource from '@tradle/validate-resource'
import { TYPE } from '@tradle/constants'
import { Conf } from '../configure'
import { getNonPendingApplications } from '../utils'
import { Bot, CreatePlugin, IPluginLifecycleMethods, ValidatePluginConf } from '../types'

const PRODUCT_REQUEST = 'tradle.ProductRequest'

interface LimitApplicationsConf {
  products: {
    productId: number
  }
}

export const createPlugin: CreatePlugin<void> = ({ bot, productsAPI }, { conf, logger }) => {
  const plugin: IPluginLifecycleMethods = {
    onRequestForExistingProduct: async req => {
      const { user, payload } = req
      // debugger
      if (payload[TYPE] !== PRODUCT_REQUEST) return

      const type = payload.requestFor

      if (!conf.products || !conf.products[type]) return

      const max = conf.products[type] || 1
      const existing = getNonPendingApplications(user).filter(
        ({ requestFor }) => requestFor === type
      )
      if (existing.length < max) {
        try {
          return await productsAPI.addApplication({ req })
        } catch (err) {
          logger.error('failed to limitApplications form', {
            stack: err.stack
          })
        }
      } else {
        // debugger
        const model = bot.models[type]
        await productsAPI.send({
          req,
          user,
          object: `You already have a ${model.title}!`
        })
      }
    }
  }

  return { plugin }
}

export const validateConf: ValidatePluginConf = async ({ bot, conf, pluginConf }) => {
  const { models } = bot
  const { products } = pluginConf
  if (!products) throw new Error(`empty conf`)

  for (let productId in products) {
    const max = products[productId]
    if (!models[productId]) throw new Error(`Unknown product ${productId}`)
    else if (typeof max !== 'number')
      throw new Error(`Max number of applications should be a number`)
    else if (max <= 0) throw new Error(`Max number of applications should be bigger than 0`)
  }
}
