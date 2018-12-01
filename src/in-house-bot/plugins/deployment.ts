import { selectModelProps } from '../../utils'
import {
  IPluginOpts,
  CreatePlugin,
  IDeploymentConf,
  IDeploymentPluginConf,
  IPBReq,
  ValidatePluginConf,
  UpdatePluginConf,
  PluginLifecycle,
  IChildDeployment,
  VersionInfo,
} from '../types'

import Errors from '../../errors'
import constants from '../../constants'
import { Deployment, createDeployment } from '../deployment'
import { TYPES, TRADLE } from '../constants'
import { getParsedFormStubs, didPropChange } from '../utils'

const { TYPE, WEB_APP_URL } = constants
const templateFileName = 'compiled-cloudformation-template.json'
const { DEPLOYMENT_PRODUCT, DEPLOYMENT_CONFIG_FORM, SIMPLE_MESSAGE } = TYPES

export interface IDeploymentPluginOpts extends IPluginOpts {
  conf: IDeploymentPluginConf
}

export const createPlugin:CreatePlugin<Deployment> = (components, { conf, logger }:IDeploymentPluginOpts) => {
  const { bot, applications, productsAPI, employeeManager, alerts } = components
  const orgConf = components.conf
  const { org } = orgConf
  const deployment = createDeployment({ bot, logger, conf, org })
  const getBotPermalink = bot.getPermalink()
  const onFormsCollected = async ({ req, user, application }) => {
    if (application.requestFor !== DEPLOYMENT_PRODUCT) return

    let form
    if (req && req.payload && req.payload[TYPE] === DEPLOYMENT_CONFIG_FORM) {
      form = req.payload
    } else {
      const latest = getParsedFormStubs(application).reverse()
        .find(({ type }) => type === DEPLOYMENT_CONFIG_FORM)

      const { link } = latest
      form = await bot.objects.get(link)
    }

    const link = form._link
    const configuration = Deployment.parseConfigurationForm(form)
    const botPermalink = await getBotPermalink
    const deploymentOpts = {
      ...configuration,
       // backwards compat
      stackName: configuration.stackName || configuration.stackPrefix,
      configurationLink: link,
    } as IDeploymentConf

    // async
    bot.sendSimpleMessage({
      to: user,
      message: `Generating a template and code package for your MyCloud. This could take up to 30 seconds...`
    })

    let launchUrl
    try {
      launchUrl = (await deployment.genLaunchPackage(deploymentOpts)).url
    } catch (err) {
      if (!Errors.matches(err, Errors.InvalidInput)) {
        logger.error('failed to generate launch url', err)
        await productsAPI.sendSimpleMessage({
          req,
          to: user,
          message: `hmm, something went wrong, we'll look into it`
        })

        return
      }

      logger.debug('failed to generate launch url', err)
      await applications.requestEdit({
        req,
        item: selectModelProps({ object: form, models: bot.models }),
        details: {
          message: err.message
        }
      })

      return
    }

    logger.debug('generated launch url', { launchUrl })
    await productsAPI.sendSimpleMessage({
      req,
      to: user,
      message: `🚀 [Click to launch your MyCloud](${launchUrl})`
      // \n\nInvite employees using this link: ${employeeOnboardingUrl}`
    })

    if (!conf.senderEmail) {
      logger.debug('unable to send email to AWS admin as conf is missing "senderEmail"')
      return
    }

    const { adminEmail } = form
    try {
      await bot.mailer.send({
        from: conf.senderEmail,
        to: adminEmail,
        ...deployment.genLaunchEmail({
          launchUrl,
          fromOrg: org
        })
      })
    } catch (err) {
      logger.error(`failed to send email to admin`, {
        deploymentOpts,
        error: err.stack
      })

      return
    }

    try {
      await productsAPI.sendSimpleMessage({
        req,
        to: user,
        message: `We've sent the respective link(s) to the designated AWS Admin (${adminEmail})`
      })
    } catch (err) {
      logger.error('failed to send notification to chat', err)
    }
  }

  const onChildDeploymentChanged:PluginLifecycle.onResourceChanged = async ({ old, value }) => {
    if (didPropChange({ old, value, prop: 'stackId' })) {
      // using bot.tasks is hacky, but because this fn currently purposely stalls for minutes on end,
      // stream-processor will time out processing this item and the lambda will exit before anyone gets notified
      bot.tasks.add({
        name: 'notify creators of child deployment',
        promise: deployment.notifyCreatorsOfChildDeployment(value)
      })
    }

    const from = old as IChildDeployment
    const to = value as IChildDeployment
    if (from.version.commit === to.version.commit) {
      try {
        await alerts.childRolledBack({ to })
      } catch (err) {
        logger.error('failed to alert about child update', err)
      }

      return
    }

    const freshlyDeployed = !from.stackId && to.stackId
    if (freshlyDeployed) {
      try {
        await alerts.childLaunched(to as any)
      } catch (err) {
        logger.error('failed to alert about new child', err)
      }
    } else {
      try {
        await alerts.childUpdated({ from, to })
      } catch (err) {
        logger.error('failed to alert about child update', err)
      }
    }
  }

  const onVersionInfoCreated:PluginLifecycle.onResourceCreated = async (resource) => {
    if (resource._org === TRADLE.PERMALINK && Deployment.isStableReleaseTag(resource.tag)) {
      await alerts.updateAvailable({
        current: bot.version,
        update: resource as VersionInfo
      })
    }
  }

  return {
    api: deployment,
    plugin: {
      onFormsCollected,
      'onmessage:tradle.cloud.UpdateRequest': async (req: IPBReq) => {
        try {
          await deployment.handleUpdateRequest({
            req: req.payload,
            from: req.user
          })
        } catch (err) {
          Errors.ignoreNotFound(err)
          logger.debug('version not found', Errors.export(err))
        }
      },
      'onmessage:tradle.cloud.UpdateResponse': async (req: IPBReq) => {
        await deployment.handleUpdateResponse(req.payload)
      },
      'onResourceChanged:tradle.cloud.ChildDeployment': onChildDeploymentChanged,
      'onResourceCreated:tradle.cloud.ChildDeployment': value => onChildDeploymentChanged({ old: {}, value }),
      'onResourceCreated:tradle.VersionInfo': onVersionInfoCreated,
    } as PluginLifecycle.Methods
  }
}

export const validateConf:ValidatePluginConf = async ({ bot, pluginConf }) => {
  const { senderEmail } = pluginConf as IDeploymentPluginConf
  if (senderEmail) {
    const resp = await bot.mailer.canSendFrom(senderEmail)
    if (!resp.result) {
      throw new Error(resp.reason)
    }
  }
}

export const updateConf:UpdatePluginConf = async ({ bot, pluginConf }) => {
  const { replication } = pluginConf as IDeploymentPluginConf
  if (!replication) return

  const { regions } = replication
  const { logger } = bot
  const deployment = createDeployment({ bot, logger })
  await deployment.createRegionalDeploymentBuckets({
    regions: regions.filter(r => r !== bot.env.AWS_REGION)
  })
}
