import _ from 'lodash'
import { randomBytes } from 'crypto'
import { selectModelProps, wait } from '../../utils'
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
  MyCloudLaunchTemplate,
  Logger
} from '../types'

import Errors from '../../errors'
import constants from '../../constants'
import { Deployment, createDeployment } from '../deployment'
import { TRADLE, TYPES } from '../constants'
import { didPropChange, getParsedFormStubs } from '../utils'
import { ClientCache, createClientCache } from '@tradle/aws-client-factory'
import AWS, { Request, AWSError } from 'aws-sdk'
import { CreateAccountResponse, CreateAccountStatus, CreateAccountRequest } from 'aws-sdk/clients/organizations'
import { AssumeRoleResponse } from 'aws-sdk/clients/sts'
import Cloudformation, { Stack, StackStatus, Stacks } from 'aws-sdk/clients/cloudformation'
import { PromiseResult } from 'aws-sdk/lib/request'
import { createConfig } from '../../aws/config'

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
      template = {
        template: null,
        stackName: 'tdl-tradle-ltd-dev',
        templateUrl: 'https://tdl-superawesome-ltd-dev-serverlessdeploymentbuck-1vlhszu8eejmx.s3.us-east-1.amazonaws.com/templates/template-b135f8c5-1636343495313-9786b33892.json',
        region: 'us-east-1',
        url: 'https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?stackName=tdl-tradle-ltd-dev&templateURL=https%3A%2F%2Ftdl-superawesome-ltd-dev-serverlessdeploymentbuck-1vlhszu8eejmx.s3.us-east-1.amazonaws.com%2Ftemplates%2Ftemplate-b135f8c5-1636343495313-9786b33892.json'
      }
      //template = await deployment.genLaunchPackage(deploymentOpts)
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

    const tmpID = randomBytes(6).toString('hex')

    const aws = createClientCache({
      AWS,
      defaults: createConfig({
        region: bot.env.AWS_REGION,
        local: bot.env.IS_LOCAL,
        iotEndpoint: bot.endpointInfo.endpoint,
        accessKeyId: conf.accessKeyId,
        secretAccessKey: conf.secretAccessKey
      })
    })

    let accountStatus: CreateAccountStatus
    try {
      // Using test account as its Lambda quotas are increased
      accountStatus = {
        Id: 'car-xxx', // Not used
        AccountName: 'Test User',
        State: 'SUCCEEDED',
        RequestedTimestamp: new Date('1970-01-01T00:00:00.000Z'),
        CompletedTimestamp: new Date('1970-01-01T00:00:00.000Z'),
        AccountId: '294133443678'
      }
      /*
      TMP account created previous
      accountStatus = {
        Id: 'car-6953d6203fe711ec8a6d0a3d7c72f24d',
        AccountName: 'TMP_ACCOUNT_42aa2be3678c',
        State: 'SUCCEEDED',
        RequestedTimestamp: new Date('2021-11-07T16:26:08.284Z'),
        CompletedTimestamp: new Date('2021-11-07T16:26:11.246Z'),
        AccountId: '549987204052'
      }
      */
      /*
      accountStatus = await createAccount(logger, aws, {
        AccountName: `TMP_ACCOUNT_${tmpID}`,
        Email: `martin.heidegger+tradle_${tmpID}@gmail.com`,
        IamUserAccessToBilling: 'DENY',
        RoleName: 'OrganizationAccountAccessRole'
      })
      */

      console.log({
        accountStatus,
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

    let assumeSession: PromiseResult<AssumeRoleResponse, AWSError>
    try {
      assumeSession = await aws.sts.assumeRole({
        RoleArn: `arn:aws:iam::${accountStatus.AccountId}:role/OrganizationAccountAccessRole`,
        RoleSessionName: 'AssumingRoleSetupSession'
      }).promise()

      const { error } = assumeSession.$response
      if (error) {
        throw new Error(`Error while assuming temporary account [${error.statusCode}][${error.code}] ${error.stack || error.message}`)
      }
    } catch (err) {
      logger.debug('Failed to assume temporary account', err)
      await applications.requestEdit({
        req,
        item: selectModelProps({ object: form, models: bot.models }),
        details: {
          message: `Error creating account: ${err.message}`
        }
      })
      return
    }

    console.log({ assumeSession })

    await productsAPI.sendSimpleMessage({
      req,
      to: user,
      message: `Account Created ${tmpID}:
  ACCESS_KEY_ID: ${assumeSession.Credentials.AccessKeyId}
  SECRET_ACCESS_KEY: ${assumeSession.Credentials.SecretAccessKey}
  EXPIRATION: ${assumeSession.Credentials.Expiration}
  SESSIOn_TOKEN: ${assumeSession.Credentials.SessionToken}
      `
      // \n\nInvite employees using this link: ${employeeOnboardingUrl}`
    })

    try {
      const cf = new Cloudformation({
        region: bot.env.AWS_REGION,
        accessKeyId: assumeSession.Credentials.AccessKeyId,
        secretAccessKey: assumeSession.Credentials.SecretAccessKey,
        sessionToken: assumeSession.Credentials.SessionToken
      })
      console.log({
        stack: await launchStack(logger, cf, template.templateUrl)
      })
    } catch (err) {
      logger.debug('Failed create stack', err)
      await applications.requestEdit({
        req,
        item: selectModelProps({ object: form, models: bot.models }),
        details: {
          message: `Error launching stack: ${err.message}`
        }
      })
      return
    }

    await applications.requestEdit({
      req,
      item: selectModelProps({ object: form, models: bot.models }),
      details: {
        message: 'no error, just resetting to test'
      }
    })
    return
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

async function launchStack (logger: Logger, cf: Cloudformation, templateUrl: string): Promise<Stack> {
  const stackName = `tdl-tradle-${randomBytes(6).toString('hex')}`
  logger.debug(`Launching stack ${stackName} from template ${templateUrl}`)
  const { $response: { error, data } } = await cf.createStack({
    TemplateURL: templateUrl,
    StackName: stackName,
    Capabilities: [
      'CAPABILITY_NAMED_IAM'
    ]
  }).promise()
  if (error) {
    throw new Error(`Error while launching stack [${error.statusCode}][${error.code}] ${error.stack || error.message} (${error.extendedRequestId})`)
  }
  if (!data) {
    throw new Error('expected data to be returned')
  }
  const { StackId } = data
  if (!StackId) {
    throw new Error('expected stackid to be returned')
  }
  let status: StackStatus|null = null
  while (true) {
    logger.debug(`Waiting 250ms for stack update of ${stackName}`)
    await wait(250)
    let stacks: Stacks
    try {
      stacks = (await cf.describeStacks({
        StackName: stackName
      }).promise()).Stacks
    } catch (err) {
      throw new Error(`Error while describing stack ${err.stack}`)
    }
    for (const stack of stacks) {
      if (stack.StackName !== stackName) {
        continue
      }
      if (stack.StackStatus === status) {
        continue
      }
      status = stack.StackStatus
      logger.debug(`Stack ${stackName} now in state [${status}]`)
      if (status === 'CREATE_COMPLETE') {
        return stack
      }
      if (
        status === 'CREATE_FAILED' ||
        status === 'ROLLBACK_COMPLETE' ||
        status === 'DELETE_FAILED' ||
        status === 'DELETE_COMPLETE'
      ) {
        throw new Error(`Stack creation failed status!`)
      }
    }
  }
}

async function createAccount (logger: Logger, aws: ClientCache, conf: CreateAccountRequest): Promise<CreateAccountStatus> {
  logger.debug(`Creating account: ${conf.AccountName} (${conf.Email})`)
  let status = await processCreateAccountStatus(aws.organizations.createAccount(conf))
  const start = Date.now()
  const max = 30000
  const waitfor = 100
  while (Date.now() - start < max) {
    if (status.State === 'FAILED') {
      throw new Error(`Couldnt create subaccount for deployment [${status.FailureReason}]`)
    }
    if (status.State !== 'IN_PROGRESS') {
      return status
    }
    logger.debug(`State still in progress, waiting for ${waitfor}ms before checking again. (${Date.now() - start} ms left)`)
    await wait(waitfor)
    status = await processCreateAccountStatus(aws.organizations.describeCreateAccountStatus({
      CreateAccountRequestId: status.Id
    }))
  }
  throw new Error(`Timeout while waiting for account to be created ${Date.now() - start}.`)
}

async function processCreateAccountStatus (req: Request<CreateAccountResponse, AWSError>): Promise<CreateAccountStatus> {
  const account = await req.promise()
  const accountStatus = account.CreateAccountStatus
  if (!accountStatus) {
    const { error } = account.$response
    throw new Error(error ? error.stack ?? `[${error.statusCode}:${error.code}] ${error.message} (${error.extendedRequestId})` : 'Didnt get a response status?!')
  }
  return accountStatus
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
