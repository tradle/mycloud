import { omit, cloneDeep } from 'lodash'
import { parseStub } from '../../utils'
import { TYPE } from '@tradle/constants'
import { prettify } from '../../string-utils'
import { getFaviconURL, getLogo } from '../image-utils'
import {
  Env,
  Bot,
  Bucket,
  IPluginOpts,
  IDeploymentOpts
} from '../types'

import { createDeployment } from '../deployment'

const templateFileName = 'compiled-cloudformation-template.json'
const MIN_SCALE = 1
const MAX_SCALE = 1
const CONFIG_FORM = 'tradle.cloud.Configuration'
const DEPLOYMENT_PRODUCT = 'tradle.cloud.Deployment'
const SIMPLE_MESSAGE = 'tradle.SimpleMessage'

export const createPlugin = (opts:IPluginOpts) => {
  const deployment = createDeployment(opts)
  const { bot, productsAPI } = opts
  const onFormsCollected = async ({ req, user, application }) => {
    if (application.requestFor !== DEPLOYMENT_PRODUCT) return

    const latest = application.forms.slice().reverse().find(stub => {
      return parseStub(stub).type === CONFIG_FORM
    })

    const form = await bot.objects.get(parseStub(latest).link)
    const url = await deployment.getLaunchUrl(form as IDeploymentOpts)
    await productsAPI.send({
      req,
      to: user,
      // object: `Launch your Tradle stack\n**${launchURL}**`
      object: {
        [TYPE]: SIMPLE_MESSAGE,
        message: `🚀 **[Launch MyCloud](${url})**`
        // message: '**Launch MyCloud**'
      }
    })
  }

  return {
    deployment,
    plugin: {
      onFormsCollected
    }
  }
}
