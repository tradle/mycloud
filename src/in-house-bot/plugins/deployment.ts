import _ from 'lodash'
import { randomBytes } from 'crypto'
import { selectModelProps } from '../../utils'
import {
  CreatePlugin,
  IChildDeployment,
  IDeploymentConf,
  IDeploymentPluginConf,
  IPBReq,
  IPluginOpts,
  PluginLifecycle,
  UpdatePluginConf,
  ValidatePluginConf,
  VersionInfo,
  MyCloudLaunchTemplate
} from '../types'

import Errors from '../../errors'
import constants from '../../constants'
import { Deployment, createDeployment } from '../deployment'
import { TRADLE, TYPES } from '../constants'
import { didPropChange, getParsedFormStubs } from '../utils'
import { createClientCache } from '@tradle/aws-client-factory'
import { createConfig } from '../../aws/config'
import AWS from 'aws-sdk'

const { TYPE } = constants
const { DEPLOYMENT_PRODUCT, DEPLOYMENT_CONFIG_FORM } = TYPES
const getCommit = (childDeployment: IChildDeployment) => _.get(childDeployment, 'version.commit')

export interface IDeploymentPluginOpts extends IPluginOpts {
  conf: IDeploymentPluginConf
}

export const createPlugin: CreatePlugin<Deployment> = (
  components,
  { conf, logger }: IDeploymentPluginOpts
) => {
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
      const latest = getParsedFormStubs(application)
        .reverse()
        .find(({ type }) => type === DEPLOYMENT_CONFIG_FORM)

      const { link } = latest
      form = await bot.objects.get(link)
    }

    const link = form._link
    const configuration = Deployment.parseConfigurationForm(form)
    const deploymentOpts = {
      ...configuration,
      // backwards compat
      stackName: configuration.stackName || configuration.stackPrefix,
      configurationLink: link
    } as IDeploymentConf

    // async
    bot.sendSimpleMessage({
      to: user,
      message: `Generating a template and code package for your MyCloud. This could take up to 30 seconds...`
    })

    let template: {
      template: MyCloudLaunchTemplate
      url: string
      stackName: string
      templateUrl: string
      region: string
    }
    try {
      template = await deployment.genLaunchPackage(deploymentOpts)
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

    const awsClientCache = createClientCache({
      AWS,
      defaults: createConfig({
        region: bot.env.AWS_REGION,
        local: bot.env.IS_LOCAL,
        iotEndpoint: bot.endpointInfo.endpoint,
        accessKeyId: conf.accessKeyId,
        secretAccessKey: conf.secretAccessKey
      }),
      useGlobalConfigClock: true
    })

    awsClientCache.forEach((client, name) => {
      const clientLogger = logger.sub(`aws-${name}`)
      // @ts-ignore
      awsClientCache[name] = monitorClient({ client, logger: clientLogger })
    })

    const tmpID = randomBytes(6).toString('hex')

    try {
      const account = await awsClientCache.organizations.createAccount({
        AccountName: `TMP_ACCOUNT_${tmpID}`,
        Email: `martin.heidegger+tradle_${tmpID}@gmail.com`,
        IamUserAccessToBilling: 'DENY'
      }).promise()

      console.log({
        account,
        template
      })
    } catch (err) {
      logger.debug('failed to create temporary account', err)
      await applications.requestEdit({
        req,
        item: selectModelProps({ object: form, models: bot.models }),
        details: {
          message: err.message
        }
      })
      return
    }

    await productsAPI.sendSimpleMessage({
      req,
      to: user,
      message: `Account Created ${tmpID}`
      // \n\nInvite employees using this link: ${employeeOnboardingUrl}`
    })
  }

  const maybeNotifyCreators = async ({ old, value }) => {
    if (value.configuration && didPropChange({ old, value, prop: 'stackId' })) {
      // using bot.tasks is hacky, but because this fn currently purposely stalls for minutes on end,
      // stream-processor will time out processing this item and the lambda will exit before anyone gets notified
      bot.tasks.add({
        name: 'notify creators of child deployment',
        promise: deployment.notifyCreatorsOfChildDeployment(value)
      })
    }
  }

  const onChildDeploymentCreated: PluginLifecycle.onResourceCreated = async childDeployment => {
    maybeNotifyCreators({ old: {}, value: childDeployment })

    try {
      await alerts.childLaunched(childDeployment as any)
    } catch (err) {
      logger.error('failed to alert about new child', err)
    }
  }

  const onChildDeploymentChanged: PluginLifecycle.onResourceChanged = async ({ old, value }) => {
    maybeNotifyCreators({ old, value })

    const from = old as IChildDeployment
    const to = value as IChildDeployment
    if (getCommit(from) === getCommit(to)) {
      try {
        await alerts.childRolledBack({ to })
      } catch (err) {
        logger.error('failed to alert about child update', err)
      }

      return
    }

    try {
      await alerts.childUpdated({ from, to })
    } catch (err) {
      logger.error('failed to alert about child update', err)
    }
  }

  const onVersionInfoCreated: PluginLifecycle.onResourceCreated = async resource => {
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
      'onResourceCreated:tradle.cloud.ChildDeployment': onChildDeploymentCreated,
      'onResourceChanged:tradle.cloud.ChildDeployment': onChildDeploymentChanged,
      'onResourceCreated:tradle.VersionInfo': onVersionInfoCreated
    } as PluginLifecycle.Methods
  }
}

export const validateConf: ValidatePluginConf = async ({ bot, pluginConf }) => {
  const { senderEmail } = pluginConf as IDeploymentPluginConf
  if (senderEmail) {
    const resp = await bot.mailer.canSendFrom(senderEmail)
    if (!resp.result) {
      throw new Error(`Can not send test-email using ${senderEmail}: ${resp.reason}`)
    }
  }
}

export const updateConf: UpdatePluginConf = async ({ bot, pluginConf }) => {
  const { replication } = pluginConf as IDeploymentPluginConf
  if (!replication) return

  const { regions } = replication
  const { logger } = bot
  const deployment = createDeployment({ bot, logger })
  await deployment.createRegionalDeploymentBuckets({
    regions: regions.filter(r => r !== bot.env.AWS_REGION)
  })
}
