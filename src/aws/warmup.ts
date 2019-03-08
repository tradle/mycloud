import {
  WARMUP_FUNCTION_SHORT_NAME,
  WARMUP_PERIOD,
  WARMUP_SLEEP,
  WARMUP_SOURCE_NAME,
  DEFAULT_WARMUP_EVENT,
  unitToMillis
} from '../constants'

import { LambdaClient, Logger } from '../types'
import PRICING from './lambda-pricing'

interface StringToConf {
  [x: string]: any
}

export interface LambdaWarmUpOpts {
  lambda: LambdaClient
  logger: Logger
}

export interface WarmUpOpts {
  concurrency?: number
  functions?: StringToConf
}

const DEFAULT_CONCURRENCY = 1

export class LambdaWarmUp {
  constructor(private opts: LambdaWarmUpOpts) {}
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

    const concurrency = warmUpConf[functionName].concurrency || DEFAULT_CONCURRENCY
    return {
      functionName,
      concurrency
    }
  }
  public getWarmUpInfo = yml => {
    const { functions } = yml
    const event = DEFAULT_WARMUP_EVENT
    const warmUpConfs = event.functions.map(conf => this.normalizeWarmUpConf(conf))
    warmUpConfs.forEach(conf => {
      if (!(conf.functionName in functions)) {
        throw new Error(`function ${conf.functionName} listed in warmup event does not exist`)
      }
    })

    return {
      period: WARMUP_PERIOD,
      input: event,
      warmUpConfs,
      functionName: WARMUP_FUNCTION_SHORT_NAME
    }
  }
  public estimateCost = yml => {
    const { provider, functions } = yml
    const info = this.getWarmUpInfo(yml)
    const costPerFunction = {
      [info.functionName]: {
        once: PRICING[getMemorySize(functions[WARMUP_FUNCTION_SHORT_NAME], provider)] * WARMUP_SLEEP
      }
    }

    const costs = {
      once: costPerFunction[info.functionName].once
    }

    for (let unit in unitToMillis) {
      let once = costPerFunction[info.functionName].once
      let fnCostPerPeriod = (once * unitToMillis[unit]) / info.period
      costPerFunction[info.functionName][unit] = fnCostPerPeriod
      costs[unit] = fnCostPerPeriod
    }

    for (const conf of info.warmUpConfs) {
      const { functionName, concurrency = info.input.concurrency } = conf
      const memorySize = getMemorySize(functions[functionName], provider)
      // assume a warm up takes 100ms or less
      costPerFunction[functionName] = {
        once: PRICING[memorySize] * concurrency
      }

      costs.once += costPerFunction[functionName].once
      for (let unit in unitToMillis) {
        let fnCostPerPeriod =
          (costPerFunction[functionName].once * unitToMillis[unit]) / info.period
        costPerFunction[functionName][unit] = fnCostPerPeriod
        costs[unit] += fnCostPerPeriod
      }
    }

    return {
      costs,
      costPerFunction,
      warmUpFunctionDuration: WARMUP_SLEEP
    }
  }

  public warmUp = async (opts: WarmUpOpts) => {
    const { concurrency = DEFAULT_CONCURRENCY, functions } = opts
    return await Promise.all(
      functions.map(conf => {
        return this.warmUpFunction({
          concurrency,
          ...this.normalizeWarmUpConf(conf)
        })
      })
    )
  }

  public warmUpFunction = async warmUpConf => {
    const { functionName, concurrency, alias = '$LATEST' } = warmUpConf
    const opts = {
      name: functionName,
      sync: true,
      qualifier: alias,
      arg: {
        source: WARMUP_SOURCE_NAME,
        sleep: WARMUP_SLEEP
      },
      wrapPayload: false
    }

    this.opts.logger.info(`Attempting to warm up ${concurrency} instances of ${functionName}`)
    const fnResults = await Promise.all(
      new Array(concurrency).fill(0).map(async () => {
        try {
          const resp = await this.opts.lambda.invoke(opts)
          if (!resp) {
            return {
              error: 'received empty response'
            }
          }

          let { headers, body, isBase64Encoded } = resp
          body =
            headers && body && isBase64Encoded
              ? JSON.parse(new Buffer(body, 'base64').toString())
              : resp

          this.opts.logger.info(`Warm Up Invoke Success: ${functionName}`, body)
          return body
        } catch (err) {
          this.opts.logger.info(`Warm Up Invoke Error: ${functionName}`, err.stack)
          return {
            error: err.stack
          }
        }
      })
    )

    const containers = {}
    return fnResults.reduce(
      (summary, next) => {
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
      },
      {
        functionName,
        containersCreated: 0,
        containersWarmed: 0
      }
    )
  }
}
export const createWarmup = (opts: LambdaWarmUpOpts) => new LambdaWarmUp(opts)

const getMemorySize = (conf, provider) => {
  return conf.memorySize || provider.memorySize || 128
}

const getFunctionNameFromArn = (arn: string) => arn.slice(arn.lastIndexOf('function:') + 9)
