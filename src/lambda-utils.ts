import path = require('path')
import { Lambda } from 'aws-sdk'
import { promisify } from './utils'
import Logger from './logger'

const notNull = (val:any):boolean => !!val

export default class Utils {
  private env: any
  private aws: any
  private logger: Logger
  public get thisFunctionName () {
    return this.env.AWS_LAMBDA_FUNCTION_NAME
  }

  constructor ({ env, aws }) {
    this.env = env
    this.aws = aws
    this.logger = env.sublogger('lambda-utils')
  }

  public getShortName = (name: string):string => {
    return name.slice(this.env.SERVERLESS_PREFIX.length)
  }

  public getFullName = (name: string):string => {
    const { SERVERLESS_PREFIX='' } = this.env
    return name.startsWith(SERVERLESS_PREFIX)
      ? name
      : `${SERVERLESS_PREFIX}${name}`
  }

  public invoke = async (opts: {
    name: string,
    arg?: any,
    sync?:boolean,
    log?: boolean
  }):Promise<any> => {
    const { name, arg={}, sync=true, log } = opts
    const FunctionName = this.getFullName(name)
    const params:Lambda.Types.InvocationRequest = {
      InvocationType: sync ? 'RequestResponse' : 'Event',
      FunctionName,
      Payload: JSON.stringify({
        requestContext: this.env.getRequestContext(),
        payload: arg
      })
    }

    if (log) params.LogType = 'Tail'

    const {
      StatusCode,
      Payload,
      FunctionError
    } = await this._invoke(params)

    if (FunctionError || (StatusCode && StatusCode >= 300)) {
      const message = Payload || `experienced ${FunctionError} error invoking lambda: ${name}`
      throw new Error(message)
    }

    if (sync && Payload) {
      return JSON.parse(Payload)
    }
  }

  public getConfiguration = (FunctionName:string):Promise<Lambda.Types.FunctionConfiguration> => {
    this.logger.debug(`looking up configuration for ${FunctionName}`)
    return this.aws.lambda.getFunctionConfiguration({ FunctionName }).promise()
  }

  public getStackResources = async (StackName?: string)
    :Promise<AWS.CloudFormation.StackResourceSummaries> => {
    if (!StackName) {
      StackName = this.env.STACK_ID
    }

    if (!StackName) {
      throw new Error(`expected "StackName"`)
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

  public listFunctions = async (StackName?:string):Promise<Lambda.Types.FunctionConfiguration[]> => {
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

  public updateEnvironments = async(map:(conf:Lambda.Types.FunctionConfiguration) => any) => {
    const functions = await this.getStackFunctionConfigurations()
    if (!functions) return

    const writes = functions.map(current => {
      const update = map(current)
      return update && {
        current,
        update
      }
    })
    .filter(notNull)
    .map(this.updateEnvironment)

    await Promise.all(writes)
  }

  public updateEnvironment = async (opts: {
    functionName?: string,
    current?: any,
    update: any
  }) => {
    let { functionName, update } = opts
    let { current } = opts
    if (!current) {
      if (!functionName) throw new Error('expected "functionName"')

      current = await this.getConfiguration(functionName)
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

  private _invoke = async (params:AWS.Lambda.InvocationRequest)
    :Promise<AWS.Lambda.InvocationResponse> => {
    if (this.env.IS_OFFLINE) {
      this.logger.debug(`invoking ${params.FunctionName} inside ${this.env.FUNCTION_NAME}`)
      return await this._requireAndInvoke(params)
    }

    this.logger.debug(`invoking ${params.FunctionName}`)
    return await this.aws.lambda.invoke(params).promise()
  }

  private _requireAndInvoke = async (params:AWS.Lambda.InvocationRequest)
    :Promise<AWS.Lambda.InvocationResponse> => {
    const { FunctionName, InvocationType, Payload } = params
    const shortName = this.getShortName(FunctionName)
    const yml = require('./cli/serverless-yml')
    const createLambdaContext = require('serverless-offline/src/createLambdaContext')
    const { functions } = yml
    const handlerExportPath = functions[shortName].handler
    const lastDotIdx = handlerExportPath.lastIndexOf('.')
    const handlerPath = path.resolve(__dirname, '..', handlerExportPath.slice(0, lastDotIdx))
    const handleExportName = handlerExportPath.slice(lastDotIdx + 1)
    const handler = require(handlerPath)[handleExportName]
    const event = typeof Payload === 'string' ? JSON.parse(Payload) : {}
    // not ideal as the called function may have different environment vars
    const context = createLambdaContext(FunctionName)
    const result = {
      StatusCode: InvocationType === 'Event' ? 202 : 200,
      Payload: '',
      FunctionError: ''
    }

    try {
      const promise = promisify(handler)(event, context, context.done)
      if (InvocationType === 'RequestResponse') {
        const resp = await promise
        result.Payload = JSON.stringify(resp)
      }
    } catch (err) {
      result.Payload = err.stack
      result.FunctionError = err.stack
      result.StatusCode = 400
    }

    return result
  }
}
