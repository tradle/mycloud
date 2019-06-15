
import { Bot, IConfComponents, CreatePlugin, ValidatePluginConf } from '../types'
import Errors from '../../errors'
import validateModel from '@tradle/validate-model'
const { isSubClassOf } = validateModel.utils
import constants from '@tradle/constants'
const {
  FORM,
  FINANCIAL_PRODUCT
} = constants.TYPES
const MY_PRODUCT = 'tradle.MyProduct'

type GetRequiredFormsConf = {
  [productModelId: string]: string[]
}

export const name = 'required-forms'

export const createPlugin: CreatePlugin<void> = (components, pluginOpts) => {
  const conf = pluginOpts.conf as GetRequiredFormsConf
  const getRequiredForms = async ({ user, application, productModel }) => {
    const { id } = productModel
    const forms = conf[id]
    if (forms) {
      return forms.slice()
    }
  }

  return {
    plugin: {
      getRequiredForms,
    }
  }
}

export const validateConf: ValidatePluginConf = async ({ bot, conf, pluginConf }: {
  bot: Bot
  conf: IConfComponents
  pluginConf: GetRequiredFormsConf
}) => {
  const { models } = bot
  Object.keys(pluginConf).forEach(productModelId => {
    const productModel = models[productModelId]
    if (!productModel) {
      throw new Errors.InvalidInput(`model not found: ${productModelId}`)
    }
    if (!isSubClassOf({models, model: productModel, subModel: models[FINANCIAL_PRODUCT]})) {
      throw new Errors.InvalidInput(`expected a product model: ${productModelId}`)
    }

    const forms = pluginConf[productModelId]
    if (!Array.isArray(forms)) {
      throw new Errors.InvalidInput(`expected each product to map to an array of form model ids`)
    }

    forms.forEach(formModelId => {
      const formModel = models[formModelId]
      if (!formModel) {
        throw new Errors.InvalidInput(`model not found: ${formModelId}`)
      }

      if (!isSubClassOf({models, model: formModel, subModel: models[FORM]}) &&
          !isSubClassOf({models, model: formModel, subModel: models[MY_PRODUCT]})) {
        throw new Errors.InvalidInput(`expected ${productModelId} to map to subclasses of tradle.Form or tradle.MyProduct`)
      }
    })
  })
}
