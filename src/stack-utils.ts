import _ from "lodash"
// @ts-ignore
import Promise from "bluebird"
import { Lambda } from "aws-sdk"
import { CloudFormationClient } from "@tradle/aws-cloudformation-client"
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
  ClientCache
} from "./types"

import Errors from "./errors"
import * as utils from "./utils"
import { splitCamelCaseToArray, replaceAll } from "./string-utils"

// const version = require('./version') as VersionInfo

type StackInfo = {
  arn: string
  name: string
  region: string
}

const stripDashes = str => str.replace(/[-]/g, "")

type StackUtilsOpts = {
  aws: ClientCache
  client: CloudFormationClient
  env: Env
  stackArn: string
  apiId: string
  logger?: Logger
  lambdaUtils: LambdaUtils
  deploymentBucket: Bucket
}

type UpdateEnvOpts = {
  functionName?: string
  current?: any
  update: any
}

type UpdateEnvResult = {
  functionName: string
  result?: any
  error?: Error
}

type TransformFunctionConfig = (conf: Lambda.Types.FunctionConfiguration) => any

export default class StackUtils {
  private aws?: ClientCache
  private client: CloudFormationClient
  private env: Env
  private logger: Logger
  private lambdaUtils: LambdaUtils
  private apiId: string
  private deploymentBucket: Bucket
  private get isTesting() {
    return this.env.IS_TESTING
  }
  public thisStack: StackInfo

  constructor({
    aws,
    client,
    env,
    logger,
    lambdaUtils,
    stackArn,
    apiId,
    deploymentBucket
  }: StackUtilsOpts) {
    this.aws = aws
    this.client = client
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

  public get thisStackId() {
    return this.thisStack.arn
  }
  public get thisStackArn() {
    return this.thisStack.arn
  }
  public get thisStackName() {
    return this.thisStack.name
  }

  public static resolveMappings = serverlessYml => {
    serverlessYml = _.cloneDeep(serverlessYml)
    const { resources } = serverlessYml
    const { Mappings } = resources
    const updates = []
    utils.traverse(resources).forEach(function(value) {
      if (this.key === "Fn::FindInMap") {
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

  public static get serverlessYml() {
    return require("./cli/serverless-yml")
  }
  public static get serverlessYmlWithResolvedMappings() {
    return StackUtils.resolveMappings(StackUtils.serverlessYml)
  }

  public get serverlessYml() {
    return StackUtils.serverlessYml
  }
  public get serverlessYmlWithResolvedMappings() {
    return StackUtils.serverlessYmlWithResolvedMappings
  }

  public static parseStackName = (name: string) => {
    const [service, stage] = name.match(/^(.*?)-([^-]+)$/).slice(1)
    return { service, stage }
  }

  public static parseStackArn = (arn: string) => {
    const parsed = utils.parseArn(arn)
    const name = parsed.id.split("/")[0]
    const { service, stage } = StackUtils.parseStackName(name)
    return {
      ...parsed,
      name,
      service,
      stage,
      arn
    }
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
    region = this.env.AWS_REGION,
    stackName = this.thisStackName,
    stackId = this.thisStackId,
    templateUrl
  }: IUpdateStackUrlOpts) => {
    if (!stackId) {
      const stacks = await this.client.listStacks()
      const stack = stacks.find(({ StackName }) => StackName === stackName)
      if (!stack) {
        throw new Errors.NotFound(`stack with name: ${stackName}`)
      }

      stackId = stack.StackId
    }

    return utils.getUpdateStackUrl({ stackId, templateUrl })
  }

  public static genStackName = ({ service, stage }: { service: string; stage: string }) => {
    if (!(service && stage)) throw new Error('expected "service" and "stage"')

    return `${service}-${stage}`
  }

  public genStackName = StackUtils.genStackName

  // public getStackFunctionConfigurations = async (StackName?:string)
  //   :Promise<Lambda.Types.FunctionConfiguration[]> => {
  //   const names = await this.listStackFunctions()
  //   return Promise.all(names.map(name => this.getConfiguration(name)))
  // }

  public getStackTemplateForVersion = async (version: VersionInfo) => {
    const { templateKey } = this.getStackLocation(version)
    return this.deploymentBucket.getJSON(templateKey)
  }

  public getStackTemplate = async () => {
    if (this.isTesting) {
      return this._getLocalStackTemplate()
    }

    return this.client.getStackTemplate(this.thisStackArn)
  }

  private _getLocalStackTemplate = async () => {
    return _.cloneDeep(require("./cli/cloudformation-template.json"))
  }

  private _getLocalStackParameterValues = async () => {
    const { Parameters } = require("./cli/cloudformation-template.json")
    const { getVar } = require("./cli/get-template-var")
    return _.transform(
      Parameters,
      (result, value: any, key: string) => {
        const custom = getVar(`stackParameters.${key}`)
        result[key] = typeof custom === "undefined" ? value.Default : custom
      },
      {}
    )
  }

  public static lockParametersToDefaults = (template: CFTemplate) => {
    const { Parameters = {} } = template
    Object.keys(Parameters).forEach(name => {
      const param = Parameters[name]
      if (typeof param.Default !== "undefined") {
        param.AllowedValues = [param.Default]
      }
    })
  }

  public getLambdaS3Keys = opts => this.client.getLambdaS3Keys(opts)
  public updateStack = async ({
    templateUrl,
    notificationTopics = []
  }: {
    templateUrl: string
    notificationTopics?: string[]
  }) => {
    const params: AWS.CloudFormation.UpdateStackInput = {
      StackName: this.thisStackArn,
      TemplateURL: templateUrl,
      Capabilities: ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM"],
      Parameters: []
    }

    if (notificationTopics.length) {
      params.NotificationARNs = notificationTopics
    }

    this.logger.info("updating this stack")
    return this.aws.cloudformation.updateStack(params).promise()
  }

  public enableTerminationProtection = async (stackName = this.thisStack.name) => {
    await this._changeTerminationProtection({ stackName, enable: true })
  }

  public disableTerminationProtection = async (stackName = this.thisStack.name) => {
    await this._changeTerminationProtection({ stackName, enable: false })
  }

  private _changeTerminationProtection = async ({
    stackName,
    enable
  }: {
    stackName: string
    enable: boolean
  }) => {
    await this.aws.cloudformation
      .updateTerminationProtection({
        StackName: stackName,
        EnableTerminationProtection: enable
      })
      .promise()

    this.logger.debug("changed stack termination protection", {
      protected: enable,
      stack: stackName
    })
  }

  public static getResourcesByType = (template: CFTemplate, type: string) => {
    return StackUtils.getResourceNamesByType(template, type).map(name => template.Resources[name])
  }

  public static getResourceNamesByType = (template: CFTemplate, type: string) => {
    const { Resources } = template
    return Object.keys(Resources).filter(name => Resources[name].Type === type)
  }

  public static getStackLocationKeys = ({
    stage,
    versionInfo
  }: {
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
      zipUrl: deploymentBucket.getUrlForKey(zipKey)
    }
  }

  public getStackLocation = (versionInfo: VersionInfo) =>
    StackUtils.getStackLocation({
      // stackName: this.thisStackName,
      stage: this.env.STACK_STAGE,
      versionInfo,
      deploymentBucket: this.deploymentBucket
    })

  // public changeAdminEmail = StackUtils.changeAdminEmail
}

export { StackUtils }
export const create = opts => new StackUtils(opts)

const getDateUpdatedEnvironmentVariables = () => ({
  DATE_UPDATED: String(Date.now())
})

// copied from serverless/lib/plugins/aws/lib/naming.js
const normalizePathPart = path =>
  _.upperFirst(
    _.capitalize(path)
      .replace(/-/g, "Dash")
      .replace(/\{(.*)\}/g, "$1Var")
      .replace(/[^0-9A-Za-z]/g, "")
  )

const toAutoScalingRegionFormat = (region: string) =>
  _.upperFirst(region.replace(/[^a-zA-Z0-9]/gi, ""))
