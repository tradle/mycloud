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
  Logger,
  Bot
} from '../types'

import Errors from '../../errors'
import constants from '../../constants'
import { Deployment, createDeployment, LaunchPackage } from '../deployment'
import { TRADLE, TYPES } from '../constants'
import { didPropChange, getParsedFormStubs } from '../utils'
import { ClientCache, createClientCache } from '@tradle/aws-client-factory'
import AWS, { Request, AWSError, Credentials } from 'aws-sdk'
import { CreateAccountResponse, CreateAccountStatus, CreateAccountRequest } from 'aws-sdk/clients/organizations'
import { AssumeRoleResponse } from 'aws-sdk/clients/sts'
import { Stack, StackStatus, Stacks } from 'aws-sdk/clients/cloudformation'
import { PromiseResult } from 'aws-sdk/lib/request'
import { createConfig } from '../../aws/config'

const { TYPE } = constants
const { DEPLOYMENT_PRODUCT, DEPLOYMENT_CONFIG_FORM } = TYPES
const getCommit = (childDeployment: IChildDeployment) => _.get(childDeployment, 'version.commit')

export interface IDeploymentPluginOpts extends IPluginOpts {
  conf: IDeploymentPluginConf
}

interface INext <Input=any> {
  add <Output> (handler: (input: Input) => Promise<Output>): INext<Output>
  loop (cont: (input: Input) => boolean | Promise<boolean>): INext<Input>
}

interface ChainStep <Input=any, Loop=any> {
  init: (input: Input) => Promise<Loop>
  cont: (init: Loop) => boolean | Promise<boolean>
}

function chain (logger: Logger, bot: Bot, name: string, error: (err: Error) => Promise<void>): INext<void> {
  const steps: ChainStep[] = []
  let memory = undefined
  let count = 0
  let running: ChainStep = null
  let runningName = null
  let added = false
  const next = () => {
    added = true
    const taskName = `${name}:step:${count++}`
    bot.tasks.add({
      name: taskName,
      async promiser () {
        logger.debug(taskName)
        if (running === null) {
          running = steps.shift()
          runningName = `${name}:process:${running.init.name}`
          logger.debug(`${runningName} start`)
          try {
            memory = await running.init(memory)
          } catch (err) {
            logger.debug(`${runningName} error while init`, err)
            error(err)
            return
          }
        }
        try {
          if (await running.cont(memory)) {
            logger.debug(`${runningName} continue`)
            next()
            return
          }
        } catch (err) {
          logger.debug(`${runningName} error while cont`, err)
          error(err)
          return
        }
        logger.debug(`${runningName} done`)
        running = null
        if (steps.length === 0) {
          logger.debug(`${name} all-done`)
          added = false
          return
        }
        next()
      }
    })
  }
  const noloop = () => false
  const add: INext = {
    add: (handler) => {
      steps.push({
        init: handler,
        cont: noloop
      })
      if (!added) {
        next()
      }
      return add
    },
    loop: (cont) => {
      const step = steps[steps.length - 1]
      if (step.cont !== noloop) {
        throw new Error('Can set loop only once.')
      }
      step.cont = cont
      return add
    }
  } as INext
  return add
}


const passthrough = async input => input

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
      stackName: `tdl-mycloud-${randomBytes(6).toString('hex')}`,
      configurationLink: link
    } as IDeploymentConf

    chain(logger, bot, 'deployment:lauch', async err => {
      await applications.requestEdit({
        req,
        item: selectModelProps({ object: form, models: bot.models }),
        details: {
          message: err.message
        }
      })
    })
      .add(async function start () {
        await bot.sendSimpleMessage({
          to: user,
          message: `Generating a template and code package for your MyCloud. This could take up to 30 seconds...`
        })
      })
      .add(async function getTemplate (): Promise<LaunchPackage> {
        // return {
        //   template: null,
        //   stackName: 'tdl-tradle-ltd-dev',
        //   templateUrl: 'https://tdl-superawesome-ltd-dev-serverlessdeploymentbuck-1vlhszu8eejmx.s3.us-east-1.amazonaws.com/templates/template-b135f8c5-1636343495313-9786b33892.json',
        //   region: 'us-east-1',
        //   url: 'https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?stackName=tdl-tradle-ltd-dev&templateURL=https%3A%2F%2Ftdl-superawesome-ltd-dev-serverlessdeploymentbuck-1vlhszu8eejmx.s3.us-east-1.amazonaws.com%2Ftemplates%2Ftemplate-b135f8c5-1636343495313-9786b33892.json'
        // }
        return await deployment.genLaunchPackage(deploymentOpts)
      })
      .add(async function templateDone (pkg) {
        await bot.sendSimpleMessage({
          to: user,
          message: `Package generated. Creating Account.`
        })
        return pkg
      })
      .add(async function createAccount (pkg) {
        const tmpID = randomBytes(6).toString('hex')
        const awsConfig = {
          ...createConfig({
            region: bot.env.AWS_REGION,
            local: bot.env.IS_LOCAL,
            iotEndpoint: bot.endpointInfo.endpoint
          }),
          common: {
            credentials: new Credentials({
              accessKeyId: conf.accessKeyId,
              secretAccessKey: conf.secretAccessKey
            })
          }
        }
    
        const aws = createClientCache({
          AWS,
          defaults: awsConfig
        })
        let accountStatus: CreateAccountStatus
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
        return {
          aws,
          accountStatus,
          pkg,
          awsConfig
        }
      })
      .add(async function accountCreated (data) {
        await productsAPI.sendSimpleMessage({
          to: user,
          message: `Account Created ${data.accountStatus.AccountId}`
        })
        return data
      })
      .add(async function assumeSession (prev) {
        const { aws, accountStatus } = prev
        const { $response: { error, data }}: PromiseResult<AssumeRoleResponse, AWSError> = await aws.sts.assumeRole({
          RoleArn: `arn:aws:iam::${accountStatus.AccountId}:role/OrganizationAccountAccessRole`,
          RoleSessionName: 'AssumingRoleSetupSession'
        }).promise()

        if (error) {
          throw new Error(`Error while assuming temporary account [${error.statusCode}][${error.code}] ${error.stack || error.message}`)
        }
        if (!data) {
          throw new Error(`AssumeSession didnt return with data`)
        }
        return {
          ...prev,
          assumeSession: data
        }
      })
      .add(async function assumeSessionDone (prev) {
        await productsAPI.sendSimpleMessage({
          to: user,
          message: `Session Assumed`
        })
        return prev
      })
      .add(async function startLaunch (prev) {
        const { assumeSession, pkg } = prev
        const stackAws = createClientCache({
          AWS,
          defaults: {
            ...createConfig({
              region: bot.env.AWS_REGION,
              local: bot.env.IS_LOCAL,
              iotEndpoint: bot.endpointInfo.endpoint
            }),
            common: {
              credentials: new Credentials({
                accessKeyId: assumeSession.Credentials.AccessKeyId,
                secretAccessKey: assumeSession.Credentials.SecretAccessKey,
                sessionToken: assumeSession.Credentials.SessionToken
              })
            }
          }
        })
        const { $response: { error, data } } = await stackAws.cloudformation.createStack({
          TemplateURL: pkg.templateUrl,
          StackName: deploymentOpts.stackName,
          Capabilities: ['CAPABILITY_NAMED_IAM']
        }).promise()
        if (error) {
          throw new Error(`Error while launching stack [${error.statusCode}][${error.code}] ${error.stack || error.message} (${error.extendedRequestId})`)
        }
        if (!data) {
          throw new Error('expected data to be returned')
        }
        const stack: Stack = null
        const status: StackStatus = null
        return {
          ...prev,
          stackAws,
          stackId: data.StackId,
          stack,
          status
        }
      })
      .loop(async (loop) => {
        const { stackAws } = loop
        const { stackName } = deploymentOpts
        logger.debug(`Waiting 250ms for stack update of ${stackName}`)
        await wait(250)
        let stacks: Stacks
        try {
          stacks = (await stackAws.cloudformation.describeStacks({
            StackName: stackName
          }).promise()).Stacks
        } catch (err) {
          throw new Error(`Error while describing stack ${err.stack}`)
        }
        const stack = stacks.find(stack => stack.StackName === stackName)
        if (!stack) {
          throw new Error('Stack gone?')
        }
        const { StackStatus: status } = stack
        if (status === loop.status) {
          return true
        }
        loop.stack = stack
        loop.status = status
        logger.debug(`Stack ${stackName} now in state [${status}]`)
        if (status === 'CREATE_COMPLETE') {
          return false
        }
        if (
          status === 'CREATE_FAILED' ||
          status === 'ROLLBACK_COMPLETE' ||
          status === 'DELETE_FAILED' ||
          status === 'DELETE_COMPLETE'
        ) {
          throw new Error(`Stack creation failed status!`)
        }
        return true
      })
      .add(async function done (data) {
        await productsAPI.sendSimpleMessage({
          req,
          to: user,
          message: `All done ${data.stack}`
        })
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
