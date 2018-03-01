import querystring = require('querystring')
import _ = require('lodash')
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
  Conf
} from '../types'

import Errors = require('../../errors')
import constants = require('../../constants')
import { createDeployment } from '../deployment'

const { WEB_APP_URL } = constants
const templateFileName = 'compiled-cloudformation-template.json'
const CONFIG_FORM = 'tradle.cloud.Configuration'
const DEPLOYMENT_PRODUCT = 'tradle.cloud.Deployment'
const SIMPLE_MESSAGE = 'tradle.SimpleMessage'

export interface IDeploymentPluginOpts extends IPluginOpts {
  conf: IDeploymentPluginConf
}

export const createPlugin = (opts:IDeploymentPluginOpts) => {
  const { bot, productsAPI, employeeManager, conf, orgConf, logger } = opts
  const deployment = createDeployment({
    bot,
    logger,
    conf,
    orgConf
  })

  const getBotPermalink = bot.getMyIdentityPermalink()
  const onFormsCollected = async ({ req, user, application }) => {
    if (application.draft || application.requestFor !== DEPLOYMENT_PRODUCT) return

    const latest = application.forms.slice().reverse().find(stub => {
      return parseStub(stub).type === CONFIG_FORM
    })

    const { link } = parseStub(latest)
    const form = await bot.objects.get(link)
    const botPermalink = await getBotPermalink
    const deploymentOpts = { ...form, configurationLink: link } as IDeploymentOpts

    // async
    bot.sendSimpleMessage({
      to: user,
      message: `Generating the template for your MyCloud...`
    })

    let launchUrl
    try {
      launchUrl = await deployment.getLaunchUrl(deploymentOpts)
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
      message: `🚀 Launch MyCloud using this link: ${launchUrl}`
      // \n\nInvite employees using this link: ${employeeOnboardingUrl}`
    })

    const { adminEmail } = form
    try {
      await bot.mailer.send({
        from: conf.senderEmail,
        to: adminEmail,
        ...deployment.genLaunchEmail({
          launchUrl,
          fromOrg: orgConf.org
        })
      })
    } catch (err) {
      logger.error(`failed to send email to admin`, {
        deploymentOpts,
        error: err.stack
      })

      return
    }

    productsAPI.sendSimpleMessage({
      req,
      to: user,
      message: `We've sent the respective link(s) to the designated AWS Admin (${adminEmail})`
    })
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
