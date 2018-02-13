import querystring = require('querystring')
import _ = require('lodash')
import { Lambda } from 'aws-sdk'
import {
  Env,
  Logger,
  AwsApis,
  LambdaUtils,
  Bucket,
  Buckets
} from './types'

import Errors = require('./errors')
import * as utils from './utils'
import {
  LAUNCH_STACK_BASE_URL
} from './constants'

export default class StackUtils {
  private aws: AwsApis
  private env: Env
  private logger: Logger
  private lambdaUtils: LambdaUtils
  private buckets: Buckets
  private deploymentBucket: Bucket
  constructor({ aws, env, logger, lambdaUtils, buckets }: {
    aws: AwsApis
    env: Env
    logger?: Logger
    lambdaUtils: LambdaUtils
    buckets: Buckets
  }) {
    this.aws = aws
    this.env = env
    this.logger = logger || env.sublogger('stack-utils')
    this.lambdaUtils = lambdaUtils
    this.buckets = buckets
    this.deploymentBucket = this.buckets.ServerlessDeployment
  }

  public get thisStackName() {
    return this.env.STACK_ID
  }

  public listStacks = async ():Promise<AWS.CloudFormation.StackSummaries> => {
    let stacks = []
    const opts:AWS.CloudFormation.ListStacksInput = {}
    while (true) {
      let {
        StackSummaries,
        NextToken
      } = await this.aws.cloudformation.listStacks().promise()

      stacks = stacks.concat(StackSummaries)
      if (!NextToken) break
    }

    return stacks
  }

  public getLaunchStackUrl = opts => utils.launchStackUrl(opts)

  public getUpdateStackUrl = async ({
    region=this.env.AWS_REGION,
    stackName,
    templateURL
  }) => {
    const stacks = await this.listStacks()
    const stack = stacks.find(({ StackName }) => StackName === stackName)
    if (!stack) {
      throw new Errors.NotFound(`stack with name: ${stackName}`)
    }

    const qs = querystring.stringify({ stackId: stack.StackId, templateURL })
    return `${LAUNCH_STACK_BASE_URL}?region=${region}#/stacks/update?${qs}`
  }

  public getStackResources = async (StackName: string=this.thisStackName):Promise<AWS.CloudFormation.StackResourceSummaries> => {
    let resources = []
    const opts:AWS.CloudFormation.ListStackResourcesInput = { StackName }
    while (true) {
      let {
        StackResourceSummaries,
        NextToken
      } = await this.aws.cloudformation.listStackResources(opts).promise()

      resources = resources.concat(StackResourceSummaries)
      opts.NextToken = NextToken
      if (!opts.NextToken) break
    }

    return resources
  }

  public updateEnvironments = async(map:(conf:Lambda.Types.FunctionConfiguration) => any) => {
    if (this.env.TESTING) {
      this.logger.debug(`updateEnvironments is skipped in test mode`)
      return
    }

    const functions = await this.getStackFunctionConfigurations()
    if (!functions) return

    const writes = functions.map(current => {
      const update = map(current)
      return update && {
        current,
        update
      }
    })
    .filter(_.identity)
    .map(this.updateEnvironment)

    await Promise.all(writes)
  }

  public updateEnvironment = async (opts: {
    functionName?: string,
    current?: any,
    update: any
  }) => {
    if (this.env.TESTING) {
      this.logger.debug(`updateEnvironment is skipped in test mode`)
      return
    }

    let { functionName, update } = opts
    let { current } = opts
    if (!current) {
      if (!functionName) throw new Error('expected "functionName"')

      current = await this.lambdaUtils.getConfiguration(functionName)
    }

    functionName = current.FunctionName
    const updated = {}
    const { Variables } = current.Environment
    for (let key in update) {
      // allow null == undefined
      if (Variables[key] != update[key]) {
        updated[key] = update[key]
      }
    }

    if (!Object.keys(updated).length) {
      this.logger.debug(`not updating "${functionName}", no new environment variables`)
      return
    }

    this.logger.debug(`updating "${functionName}" with new environment variables`)
    for (let key in updated) {
      let val = updated[key]
      if (val == null) {
        delete Variables[key]
      } else {
        Variables[key] = val
      }
    }

    await this.aws.lambda.updateFunctionConfiguration({
      FunctionName: functionName,
      Environment: { Variables }
    }).promise()
  }

  public forceReinitializeContainers = async (functions?:string[]) => {
    await this.updateEnvironments(({ FunctionName }) => {
      if (!functions || functions.includes(FunctionName)) {
        return getDateUpdatedEnvironmentVariables()
      }
    })
  }

  public forceReinitializeContainer = async (functionName:string) => {
    await this.updateEnvironment({
      functionName,
      update: getDateUpdatedEnvironmentVariables()
    })
  }

  public listFunctions = async (StackName:string=this.thisStackName):Promise<Lambda.Types.FunctionConfiguration[]> => {
    let all = []
    let Marker
    let opts:Lambda.Types.ListFunctionsRequest = {}
    while (true) {
      let { NextMarker, Functions } = await this.aws.lambda.listFunctions(opts).promise()
      all = all.concat(Functions)
      if (!NextMarker) break

      opts.Marker = NextMarker
    }

    return all
  }

  public listStackFunctions = async (StackName?:string)
    :Promise<string[]> => {
    const resources = await this.getStackResources(StackName)
    const lambdaNames:string[] = []
    for (const { ResourceType, PhysicalResourceId } of resources) {
      if (ResourceType === 'AWS::Lambda::Function' && PhysicalResourceId) {
        lambdaNames.push(PhysicalResourceId)
      }
    }

    return lambdaNames
  }

  // public getStackFunctionConfigurations = async (StackName?:string)
  //   :Promise<Lambda.Types.FunctionConfiguration[]> => {
  //   const names = await this.listStackFunctions()
  //   return Promise.all(names.map(name => this.getConfiguration(name)))
  // }

  public getStackFunctionConfigurations = async (StackName?:string)
    :Promise<Lambda.Types.FunctionConfiguration[]> => {
    const [names, configs] = await Promise.all([
      this.listStackFunctions(),
      this.listFunctions()
    ])

    return configs.filter(({ FunctionName }) => names.includes(FunctionName))
  }

  public getStackTemplate = async (deploymentBucket:Bucket=this.deploymentBucket) => {
    const { buckets } = this
    const { SERVERLESS_STAGE, SERVERLESS_SERVICE_NAME } = this.env
    const artifactDirectoryPrefix = `serverless/${SERVERLESS_SERVICE_NAME}/${SERVERLESS_STAGE}`
    const templateFileName = 'compiled-cloudformation-template.json'
    const objects = await deploymentBucket.list({ Prefix: artifactDirectoryPrefix })
    const templates = objects.filter(object => object.Key.endsWith(templateFileName))
    const metadata = deploymentBucket.utils.getLatest(templates)
    if (!metadata) {
      this.logger.debug('base template not found')
      return
    }

    this.logger.debug('base template', deploymentBucket.getUrlForKey(metadata.Key))
    return await deploymentBucket.getJSON(metadata.Key)
  }

  public createPublicTemplate = async ():Promise<string> => {
    const template = await this.getStackTemplate()
    const key = `cloudformation/template.json`
    const pubConf = this.buckets.PublicConf
    await pubConf.utils.putJSON({ key, value: template, bucket: pubConf.id, publicRead: true })
    return pubConf.getUrlForKey(key)
  }
}

export { StackUtils }
export const create = opts => new StackUtils(opts)

const getDateUpdatedEnvironmentVariables = () => ({
  DATE_UPDATED: String(Date.now())
})
