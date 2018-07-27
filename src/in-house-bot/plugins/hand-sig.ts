import { TYPE } from '@tradle/constants'
import { CreatePlugin, IPluginLifecycleMethods, Conf } from '../types'

const MESSAGE = 'Please tap here and sign'
const HAND_SIGNATURE = 'tradle.HandSignature'

export const createPlugin: CreatePlugin<void> = ({ bot, productsAPI }, { logger, conf }) => {
  const { models } = bot
  const plugin:IPluginLifecycleMethods = {}
  plugin.willRequestForm = ({ application, formRequest }) => {
    const { form } = formRequest
    if (form !== HAND_SIGNATURE || formRequest.signatureFor) {
      return
    }

    if (!formRequest.prefill) {
      formRequest.prefill = {
        [TYPE]: form
      }
    }

    // hack
    // TODO: move default message generator to the end of plugins
    if (formRequest.message && formRequest.message.startsWith('Please fill out the form')) {
      formRequest.message = MESSAGE
    }

    // TODO: re-enable me after client-side bug fix for signatureFor parsing

    // const formStubs = getFormStubs(application)
    //   .filter(resource => resource[TYPE] !== 'tradle.ProductRequest')
    //   .map(resource => buildResource.stub({ models, resource }))

    // formRequest.prefill.signatureFor = formStubs
  }

  return {
    plugin
  }
}

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: any
}) => {
  // nothing to validate yet
}
