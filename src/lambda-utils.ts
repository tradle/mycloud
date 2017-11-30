import path = require('path')
import { Lambda } from 'aws-sdk'
import { promisify, createLambdaContext } from './utils'
import Logger from './logger'
import Env from './env'
import {
  WARMUP_SOURCE_NAME,
  unitToMillis
} from './constants'

import serverlessYml = require('./cli/serverless-yml')
import PRICING = require('./lambda-pricing')

const defaultConcurrency = 1
const notNull = (val:any):boolean => !!val
const RATE_REGEX = /^rate\((\d+)\s(minute|hour|day)s?\)$/

export type StringToConf = {
  [x:string]:any
}

export type WarmUpOpts = {
  concurrency?:number
  functions?:StringToConf
}

export const WARMUP_FUNCTION_SHORT_NAME = 'warmup'
export const WARMUP_FUNCTION_DURATION = 5000

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
    local?: boolean,
    log?: boolean,
    qualifier?:string
    wrapPayload?:boolean
  }):Promise<any> => {
    let {
      name,
      arg={},
      sync=true,
      log,
      local=this.env.IS_OFFLINE,
      qualifier,
      wrapPayload
    } = opts

    const FunctionName = this.getFullName(name)
    if (wrapPayload !== false) {
      arg = {
        requestContext: this.env.getRequestContext(),
        payload: arg
      }
    }

    const params:Lambda.Types.InvocationRequest = {
      InvocationType: sync ? 'RequestResponse' : 'Event',
      FunctionName,
      Payload: JSON.stringify(arg)
    }

    if (log) params.LogType = 'Tail'
    if (qualifier) params.Qualifier = qualifier

    this.logger.debug(`invoking ${params.FunctionName}`)

    let result
    if (local) {
      result = await this.invokeLocal(params)
    } else {
      result = await this.aws.lambda.invoke(params).promise()
    }

    const {
      StatusCode,
      Payload,
      FunctionError
    } = result

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
    .filter(notNull)
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

  private requireLambdaByName = (shortName:string) => {
    const { functions } = serverlessYml
    const handlerExportPath = functions[shortName].handler
    const lastDotIdx = handlerExportPath.lastIndexOf('.')
    const handlerPath = path.join('..', handlerExportPath.slice(0, lastDotIdx))
    const handleExportName = handlerExportPath.slice(lastDotIdx + 1)
    return require(handlerPath)[handleExportName]
  }

  private invokeLocal = async (params:AWS.Lambda.InvocationRequest)
    :Promise<AWS.Lambda.InvocationResponse> => {
    const { FunctionName, InvocationType, Payload } = params
    this.logger.debug(`invoking ${params.FunctionName} inside ${this.env.FUNCTION_NAME}`)
    const shortName = this.getShortName(FunctionName)
    const handler = this.requireLambdaByName(shortName)
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

  public parseRateExpression = rate => {
    const match = rate.match(RATE_REGEX)
    if (!match) throw new Error(`failed to parse rate expression: ${rate}`)

    const [val, unit] = match.slice(1)
    return Number(val) * unitToMillis[unit]
  }

  public normalizeWarmUpConf = warmUpConf => {
    if (typeof warmUpConf === 'string') {
      return {
        functionName: warmUpConf
      }
    }

    let functionName
    for (let p in warmUpConf) {
      functionName = p
      break
    }

    return {
      functionName,
      concurrency: warmUpConf[functionName].concurrency || defaultConcurrency
    }
  }

  public getWarmUpInfo = (yml) => {
    const { service, functions, provider } = yml
    const event = functions[WARMUP_FUNCTION_SHORT_NAME].events.find(event => event.schedule)
    const { rate, input } = event.schedule
    const period = this.parseRateExpression(rate)
    const warmUpConfs = input.functions.map(conf => this.normalizeWarmUpConf(conf))
    warmUpConfs.forEach(conf => {
      if (!(conf.functionName in functions)) {
        throw new Error(`function ${conf.functionName} listed in warmup event does not exist`)
      }
    })

    return {
      period,
      input,
      warmUpConfs,
      functionName: WARMUP_FUNCTION_SHORT_NAME
    }
  }

  public estimateCost = (yml) =>  {
    const { provider, functions } = yml
    const info = this.getWarmUpInfo(yml)
    const costPerFunction = {
      [info.functionName]: {
        once: PRICING[getMemorySize(functions[WARMUP_FUNCTION_SHORT_NAME], provider)] * WARMUP_FUNCTION_DURATION
      }
    }

    const costs = {
      once: costPerFunction[info.functionName].once
    }

    for (let unit in unitToMillis) {
      let once = costPerFunction[info.functionName].once
      let fnCostPerPeriod = once * unitToMillis[unit] / info.period
      costPerFunction[info.functionName][unit] = fnCostPerPeriod
      costs[unit] = fnCostPerPeriod
    }

    for (const conf of info.warmUpConfs) {
      const { functionName, concurrency=info.input.concurrency } = conf
      const memorySize = getMemorySize(functions[functionName], provider)
      // assume a warm up takes 100ms or less
      costPerFunction[functionName] = {
        once: PRICING[memorySize] * concurrency
      }

      costs.once += costPerFunction[functionName].once
      for (let unit in unitToMillis) {
        let fnCostPerPeriod = costPerFunction[functionName].once * unitToMillis[unit] / info.period
        costPerFunction[functionName][unit] = fnCostPerPeriod
        costs[unit] += fnCostPerPeriod
      }
    }

    return {
      costs,
      costPerFunction,
      warmUpFunctionDuration: WARMUP_FUNCTION_DURATION
    }
  }

  public warmUp = async (opts:WarmUpOpts) => {
    const { concurrency=defaultConcurrency, functions } = opts
    return await Promise.all(functions.map(conf => {
      return this.warmUpFunction({
        concurrency,
        ...this.normalizeWarmUpConf(conf)
      })
    }))
  }

  public warmUpFunction = async (warmUpConf) => {
    const { functionName, concurrency } = warmUpConf
    const opts = {
      name: functionName,
      sync: true,
      qualifier: this.env.SERVERLESS_ALIAS || '$LATEST',
      arg: {
        source: WARMUP_SOURCE_NAME
      },
      wrapPayload: false
    }

    this.logger.info(`Attempting to warm up ${concurrency} instances of ${functionName}`)
    const fnResults = await Promise.all(new Array(concurrency).fill(0).map(async () => {
      try {
        const resp = await this.invoke(opts)
        this.logger.info(`Warm Up Invoke Success: ${functionName}`, resp)
        return resp
      } catch (err) {
        this.logger.info(`Warm Up Invoke Error: ${functionName}`, err.stack)
        return {
          error: err.stack
        }
      }
    }))

    const containers = {}
    return fnResults.reduce((summary, next) => {
      if (next.error) {
        summary.errors++
        return summary
      }

      if (next.isVirgin) {
        summary.containersCreated++
      }

      if (!containers[summary.containerId]) {
        containers[summary.containerId] = true
        summary.containersWarmed++
      }

      return summary
    }, {
      functionName,
      containersCreated: 0,
      containersWarmed: 0
    })
  }
}

const getDateUpdatedEnvironmentVariables = () => ({
  DATE_UPDATED: String(Date.now())
})

const getMemorySize = (conf, provider) => {
  return conf.memorySize || provider.memorySize || 128
}
