import querystring = require('querystring')
import { Lambda } from 'aws-sdk'
import {
  Env,
  Logger,
  AwsApis
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
  constructor({ aws, env, logger }: {
    aws: AwsApis
    env: Env
    logger?: Logger
  }) {
    this.aws = aws
    this.env = env
    this.logger = logger || env.sublogger('stack-utils')
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

  public getStackResources = async (StackName?: string)
    :Promise<AWS.CloudFormation.StackResourceSummaries> => {
    if (!StackName) {
      StackName = this.getStackName()
    }

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

  public getStackName ():string {
    return this.env.STACK_ID
  }

  public listFunctions = async (StackName?:string):Promise<Lambda.Types.FunctionConfiguration[]> => {
    if (!StackName) {
      StackName = this.getStackName()
    }

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

}

export { StackUtils }
export const create = opts => new StackUtils(opts)
