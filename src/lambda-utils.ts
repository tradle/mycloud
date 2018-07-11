import path from 'path'
import { Lambda } from 'aws-sdk'
import { promisify, createLambdaContext } from './utils'
import {
  Logger,
  Env,
  AwsApis
} from './types'

import {
  WARMUP_SOURCE_NAME,
  WARMUP_SLEEP,
  unitToMillis
} from './constants'

import PRICING from './lambda-pricing'

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
export const WARMUP_FUNCTION_DURATION = 50 // = 5 seconds (unit is 100ms)

export default class LambdaUtils {
  private env: Env
  private aws: AwsApis
  private logger: Logger
  public get thisFunctionName () {
    return this.env.AWS_LAMBDA_FUNCTION_NAME
  }

  constructor ({ env, aws, logger }) {
    this.env = env
    this.aws = aws
    this.logger = logger
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

    const FunctionName = this.env.getStackResourceName(name)
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

    let result
    if (local) {
      this.logger.debug(`invoking local ${FunctionName}`)
      result = await this.invokeLocal(params)
    } else {
      this.logger.debug(`invoking ${FunctionName}`)
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

  private get serverlessYml() {
    return require('./cli/serverless-yml')
  }

  private requireLambdaByName = (shortName:string) => {
    const { serverlessYml } = this
    const { functions } = serverlessYml
    const handlerExportPath = functions[shortName].handler
    const lastDotIdx = handlerExportPath.lastIndexOf('.')
    const handlerPath = path.join('..', handlerExportPath.slice(0, lastDotIdx))
    // const handleExportName = handlerExportPath.slice(lastDotIdx + 1)
    const start = Date.now()
    const lambdaExports = require(handlerPath)
    this.logger.debug(`require ${handlerPath} took ${(Date.now() - start)}ms`)
    return lambdaExports
  }

  private invokeLocal = async (params:AWS.Lambda.InvocationRequest)
    :Promise<AWS.Lambda.InvocationResponse> => {
    const { serverlessYml } = this
    const { FunctionName, InvocationType, Payload } = params
    this.logger.debug(`invoking ${params.FunctionName} inside ${this.env.FUNCTION_NAME}`)
    const shortName = this.env.getStackResourceShortName(FunctionName)
    const lambdaExports = this.requireLambdaByName(shortName)
    const { functions } = serverlessYml
    const handlerExportPath = functions[shortName].handler
    const handler = lambdaExports[handlerExportPath.split('.').pop()]
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

    const concurrency = warmUpConf[functionName].concurrency || defaultConcurrency
    return {
      functionName,
      concurrency
    }
  }

  public getWarmUpInfo = (yml) => {
    const { functions } = yml
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

  public warmUpAll = async () => {
    return await this.getWarmUpInfo(this.serverlessYml).input
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
        source: WARMUP_SOURCE_NAME,
        sleep: WARMUP_SLEEP
      },
      wrapPayload: false
    }

    this.logger.info(`Attempting to warm up ${concurrency} instances of ${functionName}`)
    const fnResults = await Promise.all(new Array(concurrency).fill(0).map(async () => {
      try {
        const resp = await this.invoke(opts)
        if (!resp) {
          return {
            error: 'received empty response'
          }
        }

        let { headers, body, isBase64Encoded } = resp
        body = headers && body && isBase64Encoded
          ? JSON.parse(new Buffer(body, 'base64').toString())
          : resp

        this.logger.info(`Warm Up Invoke Success: ${functionName}`, body)
        return body
      } catch (err) {
        this.logger.info(`Warm Up Invoke Error: ${functionName}`, err.stack)
        return {
          error: err.stack
        }
      }
    }))

    const containers = {}
    return fnResults.reduce((summary, next) => {
      const { error, isCold, containerId } = next
      if (error) {
        summary.errors++
        return summary
      }

      if (isCold) {
        summary.containersCreated++
      }

      if (!containers[containerId]) {
        containers[containerId] = true
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

export { LambdaUtils }
export const create = opts => new LambdaUtils(opts)

const getMemorySize = (conf, provider) => {
  return conf.memorySize || provider.memorySize || 128
}
