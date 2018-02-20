import querystring = require('querystring')
import _ = require('lodash')
import { parseStub } from '../../utils'
import { TYPE } from '@tradle/constants'
import { prettify } from '../../string-utils'
import { getFaviconURL, getLogo } from '../image-utils'
import {
  Env,
  Bot,
  Bucket,
  IPluginOpts,
  IDeploymentOpts,
  IDeploymentPluginConf,
  Conf
} from '../types'

import { Errors, constants } from '../'
import { createDeployment } from '../deployment'

const { WEB_APP_URL } = constants
const templateFileName = 'compiled-cloudformation-template.json'
const CONFIG_FORM = 'tradle.cloud.Configuration'
const DEPLOYMENT_PRODUCT = 'tradle.cloud.Deployment'
const SIMPLE_MESSAGE = 'tradle.SimpleMessage'
const LAUNCH_MESSAGE = 'Launch your Tradle MyCloud'

const templateOpts = { interpolate: /{{([\s\S]+?)}}/g }
const templates = {
  admin: _.template(`${LAUNCH_MESSAGE}: {{launchUrl}}`, templateOpts),
  hr: _.template(`Link to give employees for onboarding: {{employeeOnboardingUrl}}`, templateOpts),
}

export const createPlugin = (opts:IPluginOpts) => {
  const deployment = createDeployment(opts)
  const { bot, productsAPI, conf, logger } = opts
  const getBotPermalink = bot.getMyIdentityPermalink()
  const onFormsCollected = async ({ req, user, application }) => {
    if (application.requestFor !== DEPLOYMENT_PRODUCT) return

    const latest = application.forms.slice().reverse().find(stub => {
      return parseStub(stub).type === CONFIG_FORM
    })

    const deploymentOpts = await bot.objects.get(parseStub(latest).link)
    let launchUrl
    try {
      launchUrl = await deployment.getLaunchUrl(deploymentOpts as IDeploymentOpts)
    } catch (err) {
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

    const botPermalink = await getBotPermalink
    const employeeOnboardingUrl = `${WEB_APP_URL}?${querystring.stringify({
      permalink: botPermalink,
      url: bot.apiBaseUrl,
      product: 'tradle.EmployeeOnboarding'
    })}`

    const emailed = {
      admin: false,
      hr: false
    }

    await productsAPI.sendSimpleMessage({
      req,
      to: user,
      message: `🚀 Launch MyCloud using this link: ${launchUrl}\n\nInvite employees using this link: ${employeeOnboardingUrl}`
    })

    try {
      await bot.mailer.send({
        from: conf.senderEmail,
        to: deploymentOpts.adminEmail,
        subject: LAUNCH_MESSAGE,
        body: templates.admin({ launchUrl })
      })

      emailed.admin = true
    } catch (err) {
      logger.error(`failed to send email to admin`, {
        deploymentOpts,
        error: err.stack
      })
    }

    try {
      await bot.mailer.send({
        from: conf.senderEmail,
        to: deploymentOpts.adminEmail,
        subject: LAUNCH_MESSAGE,
        body: templates.hr({
          employeeOnboardingUrl
        })
      })

      emailed.hr = true
    } catch (err) {
      logger.error(`failed to send email to HR`, {
        deploymentOpts,
        error: err.stack
      })
    }

    const alertedParties = []
    if (emailed.hr) alertedParties.push('HR')
    if (emailed.admin) alertedParties.push('AWS Admin')

    if (alertedParties.length) {
      productsAPI.sendSimpleMessage({
        req,
        to: user,
        message: `We've sent the respective link(s) to your ${alertedParties.join(' and ')}`
      })
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
