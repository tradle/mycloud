import { cloneDeep } from 'lodash'
import { TYPE } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { IPluginOpts, IPluginExports, IPluginLifecycleMethods, Conf } from '../types'
import { parseStub } from '../../utils'

const MESSAGE = 'Please provide your **digital hand signature**'

export const createPlugin = ({ bot, productsAPI, logger, conf }: IPluginOpts):IPluginExports => {
  const { models } = bot
  const plugin:IPluginLifecycleMethods = {}
  plugin.willRequestForm = ({ application, formRequest }) => {
    const { form } = formRequest
    if (form !== 'tradle.HandSignature' || formRequest.signatureFor) {
      return
    }

    if (!formRequest.prefill) {
      formRequest.prefill = {
        [TYPE]: form
      }
    }

    // hack
    // TODO: move default message generator to the end of plugins
    if (formRequest.message.startsWith('Please fill out the form')) {
      formRequest.message = MESSAGE
    }

    formRequest.prefill.signatureFor = cloneDeep(application.forms)
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
