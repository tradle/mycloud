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
  CreatePlugin,
  IDeploymentConf,
  IDeploymentPluginConf,
  ITradleObject,
  IPBReq,
  Conf
} from '../types'

import Errors from '../../errors'
import constants from '../../constants'
import { Deployment, createDeployment } from '../deployment'
import { TYPES } from '../constants'
import { getParsedFormStubs } from '../utils'

const { WEB_APP_URL } = constants
const templateFileName = 'compiled-cloudformation-template.json'
const { DEPLOYMENT_PRODUCT, DEPLOYMENT_CONFIG_FORM, SIMPLE_MESSAGE } = TYPES

export interface IDeploymentPluginOpts extends IPluginOpts {
  conf: IDeploymentPluginConf
}

export const createPlugin:CreatePlugin<Deployment> = (components, { conf, logger }:IDeploymentPluginOpts) => {
  const { bot, applications, productsAPI, employeeManager } = components
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
    const deploymentOpts = { ...configuration, configurationLink: link } as IDeploymentConf

    // async
    bot.sendSimpleMessage({
      to: user,
      message: `Generating a template and code package for your MyCloud. This could take a few seconds...`
    })

    let launchUrl
    try {
      launchUrl = (await deployment.genLaunchPackage(deploymentOpts)).url
    } catch (err) {
      logger.debug('failed to generate launch url', err)
      Errors.ignore(err, Errors.InvalidInput)
      await applications.requestEdit({
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
    api: deployment,
    plugin: {
      onFormsCollected,
      'onmessage:tradle.cloud.UpdateRequest': async (req: IPBReq) => {
        try {
          deployment.handleUpdateRequest({
            req: req.payload,
            from: req.user
          })
        } catch (err) {
          Errors.ignore(err, Errors.Exists)
          // await bot.send({
          //   object: {
          //     [TYPE]: 'tradle.SimpleMessage',
          //     message: 'your stack is already up to date!'
          //   },
          //   other: {
          //     inReplyTo: req.message._link
          //   }
          // })
        }
      },
      'onmessage:tradle.cloud.UpdateResponse': (req: IPBReq) => deployment.handleUpdateResponse(req.payload),
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

export const updateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: IDeploymentPluginConf
}) => {
  const { replication } = pluginConf
  if (!replication) return

  const { regions } = replication
  const { bot, logger } = conf
  const deployment = createDeployment({ bot, logger })
  await deployment.createRegionalDeploymentBuckets({ regions })
}
