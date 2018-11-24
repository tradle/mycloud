import _ from 'lodash'
// @ts-ignore
import Promise from 'bluebird'
import { Lambda } from 'aws-sdk'
import {
  Env,
  Logger,
  AwsApis,
  LambdaUtils,
  Bucket,
  ILaunchStackUrlOpts,
  IUpdateStackUrlOpts,
  VersionInfo,
  CFTemplate,
  StackLaunchParameters,
  StackUpdateParameters,
} from './types'

import Errors from './errors'
import * as utils from './utils'
import { splitCamelCaseToArray, replaceAll } from './string-utils'

import { genOptionsBlock } from './gen-cors-options-block'

// const version = require('./version') as VersionInfo

type StackInfo = {
  arn: string
  name: string
  region: string
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

const stripDashes = str => str.replace(/[-]/g, '')

type StackUtilsOpts = {
  aws: AwsApis
  env: Env
  stackArn: string
  apiId: string
  logger?: Logger
  lambdaUtils: LambdaUtils
  deploymentBucket: Bucket
}

type UpdateEnvOpts = {
  functionName?: string,
  current?: any,
  update: any
}

type UpdateEnvResult = {
  functionName: string
  result?: any
  error?: Error
}

type TransformFunctionConfig = (conf:Lambda.Types.FunctionConfiguration) => any

export default class StackUtils {
  private aws?: AwsApis
  private env: Env
  private logger: Logger
  private lambdaUtils: LambdaUtils
  private apiId: string
  private deploymentBucket: Bucket
  private get isTesting() { return this.env.IS_TESTING }
  public thisStack: StackInfo

  constructor({ aws, env, logger, lambdaUtils, stackArn, apiId, deploymentBucket }: StackUtilsOpts) {
    this.aws = aws
    this.env = env
    this.logger = logger
    this.lambdaUtils = lambdaUtils
    this.deploymentBucket = deploymentBucket

    const { arn, name } = StackUtils.parseStackArn(stackArn)
    this.thisStack = {
      arn,
      name,
      region: env.AWS_REGION
    }

    this.apiId = apiId
  }

  public get thisStackId () { return this.thisStack.arn }
  public get thisStackArn () { return this.thisStack.arn }
  public get thisStackName () { return this.thisStack.name }

  public static resolveMappings = (serverlessYml) => {
    serverlessYml = _.cloneDeep(serverlessYml)
    const { resources } = serverlessYml
    const { Mappings } = resources
    const updates = []
    utils.traverse(resources).forEach(function (value) {
      if (this.key === 'Fn::FindInMap') {
        updates.push({
          path: this.path.slice(0, -1),
          value: _.get(Mappings, value)
        })
      }
    })

    updates.forEach(({ path, value }) => _.set(resources, path, value))
    return serverlessYml
  }

  public resolveMappings = StackUtils.resolveMappings

  public static get serverlessYml() { return require('./cli/serverless-yml') }
  public static get serverlessYmlWithResolvedMappings() {
    return StackUtils.resolveMappings(StackUtils.serverlessYml)
  }

  public get serverlessYml() { return StackUtils.serverlessYml }
  public get serverlessYmlWithResolvedMappings() { return StackUtils.serverlessYmlWithResolvedMappings }

  public static parseStackName = (name: string) => {
    const [service, stage] = name.match(/^(.*?)-([^-]+)$/).slice(1)
    return { service, stage }
  }

  public static parseStackArn = (arn: string) => {
    const parsed = utils.parseArn(arn)
    const name = parsed.id.split('/')[0]
    const { service, stage } = StackUtils.parseStackName(name)
    return {
      ...parsed,
      name,
      service,
      stage,
      arn
    }
  }

  public static setTemplateParameterDefaults = (template: CFTemplate, values: any) => {
    if (!template.Parameters) template.Parameters = {}

    const { Parameters } = template
    for (let key in values) {
      Parameters[key] = utils.pickNonNull({
        Type: 'String',
        Default: values[key],
      })
    }
  }

  public parseStackArn = StackUtils.parseStackArn
  public parseStackName = StackUtils.parseStackName

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
    const { templateUrl, ...rest } = opts
    if (!templateUrl) throw new Errors.InvalidInput('expected "templateUrl"')

    return utils.getLaunchStackUrl({
      region: this.env.AWS_REGION,
      stackName: this.thisStackName,
      templateUrl,
      ...rest
    })
  }

  public getUpdateStackUrl = async ({
    region=this.env.AWS_REGION,
    stackName=this.thisStackName,
    stackId=this.thisStackId,
    templateUrl
  }: IUpdateStackUrlOpts) => {
    if (!stackId) {
      const stacks = await this.listStacks()
      const stack = stacks.find(({ StackName }) => StackName === stackName)
      if (!stack) {
        throw new Errors.NotFound(`stack with name: ${stackName}`)
      }

      stackId = stack.StackId
    }

    return utils.getUpdateStackUrl({ stackId, templateUrl })
  }

  public static genStackName = ({ service, stage }: {
    service: string
    stage: string
  }) => {
    if (!(service && stage)) throw new Error('expected "service" and "stage"')

    return `${service}-${stage}`
  }

  public genStackName = StackUtils.genStackName

  public getStackResources = async (StackName: string=this.thisStack.name):Promise<AWS.CloudFormation.StackResourceSummaries> => {
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

  public updateEnvironments = async(map:TransformFunctionConfig):Promise<UpdateEnvResult[]> => {
    if (this.isTesting) {
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

    return Promise.all(writes)
  }

  public updateEnvironment = async (opts: UpdateEnvOpts):Promise<UpdateEnvResult> => {
    const ret:UpdateEnvResult = {
      functionName: opts.functionName
    }

    try {
      ret.result = await this._updateEnvironment(opts)
    } catch (err) {
      Errors.ignoreNotFound(err)
      ret.error = new Errors.NotFound(err.message)
    }

    return ret
  }

  private _updateEnvironment = async (opts: UpdateEnvOpts) => {
    if (this.isTesting) {
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
    const results = await this.updateEnvironments(({ FunctionName }) => {
      if (!functions || functions.includes(FunctionName)) {
        this.logger.debug(`reinitializing container for lambda: ${FunctionName}`)
        return getDateUpdatedEnvironmentVariables()
      }

      this.logger.debug(`not reinitializing container for lambda: ${FunctionName}`)
    })

    const failed = results.filter(r => r.error)
    if (!failed.length) return

    this.logger.error('failed to update some containers', {
      failed: failed.map(({ functionName, error }) => ({
        functionName,
        error: error.message
      }))
    })
  }

  public forceReinitializeContainer = async (functionName:string) => {
    this.logger.debug(`reinitializing container for lambda: ${functionName}`)
    await this.updateEnvironment({
      functionName,
      update: getDateUpdatedEnvironmentVariables()
    })
  }

  public listFunctions = async (StackName:string=this.thisStack.name):Promise<Lambda.Types.FunctionConfiguration[]> => {
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

  public getStackTemplateForVersion = async (version: VersionInfo) => {
    const { templateKey } = this.getStackLocation(version)
    return this.deploymentBucket.getJSON(templateKey)
  }

  public getStackTemplate = async () => {
    if (this.isTesting) {
      return this._getLocalStackTemplate()
    }

    return StackUtils.getStackTemplate({
      cloudformation: this.aws.cloudformation,
      stackArn: this.thisStackArn,
    })
  }

  public static getStackTemplate = async ({ cloudformation, stackArn }: {
    cloudformation: AWS.CloudFormation,
    stackArn: string
  }) => {
    const { TemplateBody } = await cloudformation.getTemplate({ StackName: stackArn }).promise()
    return JSON.parse(TemplateBody)
  }

  private _getLocalStackTemplate = async () => {
    return _.cloneDeep(require('./cli/cloudformation-template.json'))
  }

  public getStackParameterValues = async (stackArn:string = this.thisStackArn) => {
    if (this.isTesting) {
      return this._getLocalStackParameterValues()
    }

    return StackUtils.getStackParameterValues({ cloudformation: this.aws.cloudformation, stackArn })
  }

  public static getStackParameterValues = async ({ cloudformation, stackArn }: {
    cloudformation: AWS.CloudFormation
    stackArn: string
  }):Promise<any> => {
    const { Parameters } = await StackUtils.describeStack({ cloudformation, stackArn })
    return Parameters.reduce((map, param) => {
      // map[param.ParameterKey] = param.ParameterValue || template.Parameters[param.ParameterKey].Default
      map[param.ParameterKey] = param.ParameterValue
      return map
    }, {})
  }

  public static describeStack = async ({ cloudformation, stackArn }: {
    cloudformation: AWS.CloudFormation
    stackArn: string
  }) => {
    const {
      Stacks,
    } = await cloudformation.describeStacks({ StackName: stackArn }).promise()

    return Stacks[0]
  }

  private _getLocalStackParameterValues = async () => {
    const { Parameters } = require('./cli/cloudformation-template.json')
    const { getVar } = require('./cli/get-template-var')
    return _.transform(Parameters, (result, value: any, key: string) => {
      const custom = getVar(`stackParameters.${key}`)
      result[key] = typeof custom === 'undefined' ? value.Default : custom
    }, {})
  }

  public getSwagger = async () => {
    if (this.isTesting) {
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
    if (this.isTesting) {
      return false
    }

    const original = _.cloneDeep(swagger)
    this.logger.debug('setting binary mime types')
    swagger['x-amazon-apigateway-binary-media-types'] = ['*/*']
    for (let path in swagger.paths) {
      let pathConf = swagger.paths[path]
      // TODO: check methods against serverless.yml
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

  public static getLambdaS3Keys = (template: CFTemplate) => {
    const { Resources } = template
    return StackUtils.getResourceNamesByType(template, 'AWS::Lambda::Function').map(name => ({
      path: `Resources['${name}'].Properties.Code.S3Key`,
      value: Resources[name].Properties.Code.S3Key
    }))
  }

  public static lockParametersToDefaults = (template: CFTemplate) => {
    const { Parameters={} } = template
    Object.keys(Parameters).forEach(name => {
      const param = Parameters[name]
      if (typeof param.Default !== 'undefined') {
        param.AllowedValues = [param.Default]
      }
    })
  }

  public getLambdaS3Keys = StackUtils.getLambdaS3Keys
  public updateStack = async ({ templateUrl, notificationTopics = [] }: {
    templateUrl: string
    notificationTopics?: string[]
  }) => {
    const params: AWS.CloudFormation.UpdateStackInput = {
      StackName: this.thisStackArn,
      TemplateURL: templateUrl,
      Capabilities: [
        'CAPABILITY_IAM',
        'CAPABILITY_NAMED_IAM'
      ],
      Parameters: [],
    }

    if (notificationTopics.length) {
      params.NotificationARNs = notificationTopics
    }

    this.logger.info('updating this stack')
    return this.aws.cloudformation.updateStack(params).promise()
  }

  public enableTerminationProtection = async (stackName=this.thisStack.name) => {
    await this._changeTerminationProtection({ stackName, enable: true })
  }

  public disableTerminationProtection = async (stackName=this.thisStack.name) => {
    await this._changeTerminationProtection({ stackName, enable: false })
  }

  private _changeTerminationProtection = async ({ stackName, enable }: {
    stackName: string
    enable: boolean
  }) => {
    await this.aws.cloudformation.updateTerminationProtection({
      StackName: stackName,
      EnableTerminationProtection: enable
    }).promise()

    this.logger.debug('changed stack termination protection', {
      protected: enable,
      stack: stackName
    })
  }

  public static getResourcesByType = (template: CFTemplate, type: string) => {
    return StackUtils.getResourceNamesByType(template, type)
      .map(name => template.Resources[name])
  }

  public static getResourceNamesByType = (template: CFTemplate, type: string) => {
    const { Resources } = template
    return Object.keys(Resources).filter(name => Resources[name].Type === type)
  }

  public static getStackLocationKeys = ({ stage, versionInfo }:  {
    stage: string
    versionInfo: VersionInfo
  }) => {
    const { tag, commit, time } = versionInfo
    const dir = `mycloud/tradle/${stage}/${tag}/${commit}`
    const templateKey = `${dir}/compiled-cloudformation-template.json`
    const zipKey = `${dir}/lambda.zip`
    return {
      dir,
      templateKey,
      zipKey
    }
  }

  public static getStackLocation = (opts: {
    stage: string
    versionInfo: VersionInfo
    deploymentBucket: Bucket
  }) => {
    const { deploymentBucket } = opts
    const loc = StackUtils.getStackLocationKeys(opts)
    const { zipKey, templateKey } = loc
    return {
      ...loc,
      templateUrl: deploymentBucket.getUrlForKey(templateKey),
      zipUrl: deploymentBucket.getUrlForKey(zipKey),
    }
  }

  public getStackLocation = (versionInfo: VersionInfo) => StackUtils.getStackLocation({
    // stackName: this.thisStackName,
    stage: this.env.STACK_STAGE,
    versionInfo,
    deploymentBucket: this.deploymentBucket
  })

  // public changeAdminEmail = StackUtils.changeAdminEmail
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

// copied from serverless/lib/plugins/aws/lib/naming.js
const normalizePathPart = path => _.upperFirst(
  _.capitalize(path)
    .replace(/-/g, 'Dash')
    .replace(/\{(.*)\}/g, '$1Var')
    .replace(/[^0-9A-Za-z]/g, '')
)

const toAutoScalingRegionFormat = (region: string) => _.upperFirst(region.replace(/[^a-zA-Z0-9]/ig, ''))
