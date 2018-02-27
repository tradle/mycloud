import querystring = require('querystring')
import _ = require('lodash')
// @ts-ignore
import Promise = require('bluebird')
import { Lambda } from 'aws-sdk'
import {
  Env,
  Logger,
  AwsApis,
  LambdaUtils,
  Bucket,
  Buckets,
  ILaunchStackUrlOpts,
  IUpdateStackUrlOpts,
  IServiceMap
} from './types'

import Errors = require('./errors')
import * as utils from './utils'
import { randomString } from './crypto'
import {
  LAUNCH_STACK_BASE_URL
} from './constants'

import { genOptionsBlock } from './gen-cors-options-block'
import { RetryableTask } from './retryable-task'

type StackInfo = {
  arn: string
  name: string
}

const X_INTEGRATION = 'x-amazon-apigateway-integration'
const ALLOW_HEADERS = 'method.response.header.Access-Control-Allow-Headers'
const METHODS = [
  'GET',
  'HEAD',
  'DELETE',
  'POST',
  'PUT',
  'PATCH'
]

export default class StackUtils {
  private aws?: AwsApis
  private serviceMap: IServiceMap
  private env: Env
  private logger: Logger
  private lambdaUtils: LambdaUtils
  private buckets: Buckets
  private deploymentBucket: Bucket
  private stack: StackInfo
  private apiId: string

  constructor({ aws, env, serviceMap, logger, lambdaUtils, buckets }: {
    aws: AwsApis
    env: Env
    serviceMap: IServiceMap
    logger?: Logger
    lambdaUtils: LambdaUtils
    buckets: Buckets
  }) {
    this.aws = aws
    this.env = env
    this.serviceMap = serviceMap
    this.logger = logger || env.sublogger('stack-utils')
    this.lambdaUtils = lambdaUtils
    this.buckets = buckets
    this.deploymentBucket = this.buckets.ServerlessDeployment

    const arn = this.serviceMap.Stack
    this.stack = StackUtils.parseStackArn(arn)
    this.apiId = this.serviceMap.RestApi.ApiGateway.id
  }

  public static parseStackName = (name: string) => {
    const [service, stage] = name.match(/^(.*?)-([^-]+)$/).slice(1)
    return { service, stage }
  }

  public static parseStackArn = (arn: string) => {
    const name = utils.parseArn(arn).id.split('/')[0]
    const { service, stage } = StackUtils.parseStackName(name)
    return {
      name,
      service,
      stage,
      arn
    }
  }

  public parseStackArn = StackUtils.parseStackArn
  public parseStackName = StackUtils.parseStackName

  public getThisStackId = () => {
    return this.stack.arn
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

  public getLaunchStackUrl = (opts: Partial<ILaunchStackUrlOpts>) => {
    const { templateURL, ...rest } = opts
    if (!templateURL) throw new Errors.InvalidInput('expected "templateURL"')

    return utils.getLaunchStackUrl({
      region: this.env.AWS_REGION,
      stackName: this.stack.name,
      templateURL,
      ...rest
    })
  }

  public getUpdateStackUrl = async ({
    region=this.env.AWS_REGION,
    stackName=this.stack.name,
    stackId=this.stack.arn,
    templateURL
  }: IUpdateStackUrlOpts) => {
    if (!stackId) {
      const stacks = await this.listStacks()
      const stack = stacks.find(({ StackName }) => StackName === stackName)
      if (!stack) {
        throw new Errors.NotFound(`stack with name: ${stackName}`)
      }

      stackId = stack.StackId
    }

    return utils.getUpdateStackUrl({
      stackId,
      templateURL
    })
  }

  public static genStackName = ({ service, stage }: {
    service: string
    stage: string
  }) => {
    if (!(service && stage)) throw new Error('expected "service" and "stage"')

    return `${service}-${stage}`
  }

  public genStackName = StackUtils.genStackName

  public getStackResources = async (StackName: string=this.stack.name):Promise<AWS.CloudFormation.StackResourceSummaries> => {
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

    for (let key in updated) {
      let val = updated[key]
      if (val == null) {
        delete Variables[key]
      } else {
        Variables[key] = val
      }
    }

    this.logger.debug(`updating "${functionName}" with new environment variables`, Variables)
    await this.aws.lambda.updateFunctionConfiguration({
      FunctionName: functionName,
      Environment: { Variables }
    }).promise()
  }

  public forceReinitializeContainers = async (functions?:string[]) => {
    await this.updateEnvironments(({ FunctionName }) => {
      if (!functions || functions.includes(FunctionName)) {
        this.logger.debug(`reinitializing container for lambda: ${FunctionName}`)
        return getDateUpdatedEnvironmentVariables()
      } else {
        this.logger.debug(`not reinitializing container for lambda: ${FunctionName}`)
      }
    })
  }

  public forceReinitializeContainer = async (functionName:string) => {
    this.logger.debug(`reinitializing container for lambda: ${functionName}`)
    await this.updateEnvironment({
      functionName,
      update: getDateUpdatedEnvironmentVariables()
    })
  }

  public listFunctions = async (StackName:string=this.stack.name):Promise<Lambda.Types.FunctionConfiguration[]> => {
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
    if (this.env.TESTING) {
      return _.cloneDeep(require('../.serverless/cloudformation-template-update-stack'))
    }

    const { buckets } = this
    const { SERVERLESS_ARTIFACTS_PATH } = this.env
    const templateFileName = 'compiled-cloudformation-template.json'
    const objects = await deploymentBucket.list({ Prefix: SERVERLESS_ARTIFACTS_PATH })
    const templates = objects.filter(object => object.Key.endsWith(templateFileName))
    const metadata = deploymentBucket.utils.getLatest(templates)
    if (!metadata) {
      this.logger.debug('base template not found')
      return
    }

    this.logger.debug('base template', deploymentBucket.getUrlForKey(metadata.Key))
    return await deploymentBucket.getJSON(metadata.Key)
  }

  public createPublicTemplate = async (transform:<T>(template:T)=>Promise<T>=utils.identityPromise) => {
    const template = await this.getStackTemplate()
    const customized = await transform(template)
    const key = `cloudformation/template-${Date.now()}-${randomString(6)}.json`
    const pubConf = this.buckets.PublicConf
    await pubConf.putJSON(key, customized, { publicRead: true })
    return {
      template: customized,
      key,
      url: pubConf.getUrlForKey(key)
    }
  }

  public enableBinaryAPIResponses = async () => {
    const swagger = await this.getSwagger()
    return await this.addBinarySupportToSwagger(swagger)
  }

  public getSwagger = async () => {
    if (this.env.TESTING) {
      return {}
    }

    const { body } = await this.aws.apigateway.getExport({
      restApiId: this.apiId,
      exportType: 'swagger',
      accepts: 'application/json',
      parameters: {
        extensions: 'integrations'
      },
      stageName: this.env.STAGE
    })
    .promise()

    return JSON.parse(body.toString())
  }

  public addBinarySupportToSwagger = async (swagger):Promise<boolean> => {
    if (this.env.TESTING) {
      return false
    }

    const original = _.cloneDeep(swagger)
    this.logger.debug('setting binary mime types')
    swagger['x-amazon-apigateway-binary-media-types'] = ['*/*']
    for (let path in swagger.paths) {
      let pathConf = swagger.paths[path]
      // TODO: check methods against serveress.yml
      let methods = METHODS
      let defaultOptionsBlock = genOptionsBlock({ methods })
      if (pathConf.options) {
        this.logger.debug(`updating existing OPTIONS integration for path: ${path}`)
        let integrationOpts = pathConf.options[X_INTEGRATION]
        if (integrationOpts) {
          if (!integrationOpts.contentHandling) {
            // THE SKELETON KEY
            integrationOpts.contentHandling = 'CONVERT_TO_TEXT'
          }

          integrationOpts.responses.default.responseParameters[ALLOW_HEADERS]
            = defaultOptionsBlock[X_INTEGRATION].responses.default.responseParameters[ALLOW_HEADERS]
        } else {
          pathConf.options[X_INTEGRATION] = defaultOptionsBlock[X_INTEGRATION]
        }
      } else {
        this.logger.debug(`setting default OPTIONS integration for path ${path}`)
        pathConf.options = defaultOptionsBlock
      }
    }

    if (_.isEqual(original, swagger)) {
      this.logger.debug('skipping update, remote swagger is already up to date')
      return false
    }

    await this.pushSwagger(swagger)
    return true
  }

  public pushSwagger = async (swagger) => {
    await this.aws.apigateway.putRestApi({
      restApiId: this.apiId,
      mode: 'merge',
      body: JSON.stringify(swagger)
    }).promise()

    await this.createDeployment()
  }

  public static replaceServiceName = ({ template, placeholder, replacement }) => {
    if (!(template && placeholder && replacement)) {
      throw new Error('expected "template", "placeholder", and "replacement"')
    }

    const s3Keys = utils.traverse(template).reduce(function (s3Keys, value) {
      if (this.key === 'S3Key') {
        s3Keys.push({
          path: this.path,
          value
        })
      }

      return s3Keys
    }, [])

    const placeholderRegex = new RegExp(placeholder, 'g')
    const replacementRegex = new RegExp(replacement, 'g')
    const resultStr = JSON.stringify(template)
      .replace(placeholderRegex, replacement)

    const result = JSON.parse(resultStr)
    s3Keys.forEach(({ path, value }) => _.set(result, path, value))
    return result
  }

  public replaceServiceName = StackUtils.replaceServiceName
  private createDeployment = async () => {
    await this.aws.apigateway.createDeployment({
      restApiId: this.apiId,
      stageName: this.env.STAGE
    }).promise()
  }
}

export { StackUtils }
export const create = opts => new StackUtils(opts)

const getDateUpdatedEnvironmentVariables = () => ({
  DATE_UPDATED: String(Date.now())
})
