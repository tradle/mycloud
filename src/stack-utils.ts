import _ from "lodash"
import {
  updateLambdaEnvironmentsForStack,
  TransformFunctionConfig,
  reinitializeContainers
} from "@tradle/aws-combo"
import { CloudFormationClient } from "@tradle/aws-cloudformation-client"
import {
  Env,
  Logger,
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

interface StackInfo {
  arn: string
  name: string
  region: string
}

const stripDashes = str => str.replace(/[-]/g, "")

interface StackUtilsOpts {
  aws: ClientCache
  cfClient: CloudFormationClient
  env: Env
  stackArn: string
  apiId: string
  logger?: Logger
  lambdaUtils: LambdaUtils
  deploymentBucket: Bucket
}

export default class StackUtils {
  private aws?: ClientCache
  private cfClient: CloudFormationClient
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
    cfClient,
    env,
    logger,
    lambdaUtils,
    stackArn,
    apiId,
    deploymentBucket
  }: StackUtilsOpts) {
    this.aws = aws
    this.cfClient = cfClient
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
      const stacks = await this.cfClient.listStacks()
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

    return this.cfClient.getStackTemplate(this.thisStackArn)
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

  public updateEnvironments = async (map: TransformFunctionConfig) =>
    this.updateEnvironmentsForStack({
      stackName: this.thisStackArn,
      map
    })

  public updateEnvironmentsForStack = async ({
    map,
    stackName
  }: {
    map: TransformFunctionConfig
    stackName: string
  }) => {
    await updateLambdaEnvironmentsForStack({
      lambda: this.lambdaUtils,
      cloudformation: this.cfClient,
      stackName,
      map
    })
  }

  public getStackResources = () => this.cfClient.getStackResources(this.thisStackArn)
  public getStackParameterValues = () => this.cfClient.getStackParameterValues(this.thisStackArn)
  public updateStack = opts => this.cfClient.updateStack({ stackName: this.thisStackArn, ...opts })
  public reinitializeContainers = async (functions?: string[]) =>
    reinitializeContainers({
      cloudformation: this.cfClient,
      lambda: this.lambdaUtils,
      functions,
      stackName: functions ? null : this.thisStackArn
    })

  // public changeAdminEmail = StackUtils.changeAdminEmail
}

export { StackUtils }
export const create = opts => new StackUtils(opts)

// copied from serverless/lib/plugins/aws/lib/naming.js
// const normalizePathPart = path =>
//   _.upperFirst(
//     _.capitalize(path)
//       .replace(/-/g, "Dash")
//       .replace(/\{(.*)\}/g, "$1Var")
//       .replace(/[^0-9A-Za-z]/g, "")
//   )

// const toAutoScalingRegionFormat = (region: string) =>
//   _.upperFirst(region.replace(/[^a-zA-Z0-9]/gi, ""))
