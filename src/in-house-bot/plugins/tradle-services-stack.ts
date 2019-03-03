import { parseArn } from '../../utils'
import {
  CreatePlugin,
  IChildDeployment,
  IPluginOpts,
  PluginLifecycle,
  ValidatePluginConf
} from '../types'
import Errors from '../../errors'
import {
  TradleServicesStack,
  TradleServicesStackOpts,
  createServicesStackApi
} from '../tradle-services-stack'

export interface TradleServicesStackPluginOpts extends IPluginOpts {
  conf: TradleServicesStackOpts
}

export const name = 'tradleServicesStack'

export const createPlugin: CreatePlugin<TradleServicesStack> = (
  components,
  pluginOpts: TradleServicesStackPluginOpts
) => {
  const { bot } = components
  const { conf, logger } = pluginOpts
  const servicesStack = createServicesStackApi(conf)
  const ensurePushNotificationsRegistration = async (childDeployment: IChildDeployment) => {
    const { identity, stackId } = childDeployment
    if (!(identity && stackId)) return

    const friend = await bot.friends.getByIdentityPermalink(identity._permalink)
    // TODO: check if friend paid their dues

    logger.debug('registering child deployment as push notifier')
    const { region, accountId } = parseArn(stackId)
    await servicesStack.registerPushNotifier({
      permalink: identity._permalink,
      region,
      accountId
    })
  }

  const onChildDeploymentCreated: PluginLifecycle.onResourceCreated = async childDeployment => {
    try {
      await ensurePushNotificationsRegistration(childDeployment as IChildDeployment)
    } catch (err) {
      logger.error('1. failed to ensure push notifications registration', err)
    }
  }

  const onChildDeploymentChanged: PluginLifecycle.onResourceChanged = async ({ value }) => {
    try {
      await ensurePushNotificationsRegistration(value as IChildDeployment)
    } catch (err) {
      logger.error('2. failed to ensure push notifications registration', err)
    }
  }

  return {
    api: servicesStack,
    plugin: {
      'onResourceCreated:tradle.cloud.ChildDeployment': onChildDeploymentCreated,
      'onResourceChanged:tradle.cloud.ChildDeployment': onChildDeploymentChanged
    }
  }
}

export const validateConf: ValidatePluginConf = async ({ pluginConf }) => {
  const { apiKey, endpoint } = pluginConf as TradleServicesStackOpts
  if (!(apiKey && endpoint)) {
    throw new Errors.InvalidInput(`expected "apiKey" and "endpoint"`)
  }
}
