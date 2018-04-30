import querystring from 'querystring'
import _ from 'lodash'
import { parseStub } from '../../utils'
import { TYPE } from '@tradle/constants'
import { prettify } from '../../string-utils'
import {
  Env,
  Bot,
  Bucket,
  IPluginOpts,
  IDeploymentOpts,
  IDeploymentPluginConf,
  ITradleObject,
  Conf
} from '../types'

import Errors from '../../errors'
import constants from '../../constants'
import { createDeployment } from '../deployment'
import { TYPES } from '../constants'
import { getParsedFormStubs } from '../utils'

const { WEB_APP_URL } = constants
const templateFileName = 'compiled-cloudformation-template.json'
const { DEPLOYMENT_PRODUCT, DEPLOYMENT_CONFIG_FORM, SIMPLE_MESSAGE } = TYPES

export interface IDeploymentPluginOpts extends IPluginOpts {
  conf: IDeploymentPluginConf
}

export const createPlugin = (components, { conf, logger }:IDeploymentPluginOpts) => {
  const { bot, productsAPI, employeeManager } = components
  const orgConf = components.conf
  const { org } = orgConf
  const deployment = createDeployment({
    bot,
    logger,
    conf,
    orgConf
  })

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
    const configuration = deployment.parseConfigurationForm(form)
    const botPermalink = await getBotPermalink
    const deploymentOpts = { ...configuration, configurationLink: link } as IDeploymentOpts

    // async
    bot.sendSimpleMessage({
      to: user,
      message: `Generating the template for your MyCloud...`
    })

    let launchUrl
    try {
      launchUrl = (await deployment.genLaunchTemplate(deploymentOpts)).url
    } catch (err) {
      logger.debug('failed to generate launch url', err)
      Errors.ignore(err, Errors.InvalidInput)
      await this.productsAPI.requestEdit({
        req,
        item: deploymentOpts,
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

  return {
    deployment,
    plugin: {
      onFormsCollected
    }
  }
}

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: IDeploymentPluginConf
}) => {
  const { senderEmail } = pluginConf
  if (!senderEmail) {
    throw new Error('expected "senderEmail"')
  }

  const canSend = await conf.bot.mailer.canSendFrom(senderEmail)
  if (!canSend) {
    throw new Error(`cannot send emails from "${senderEmail}".
Check your AWS Account controlled addresses at: https://console.aws.amazon.com/ses/home`)
  }
}
