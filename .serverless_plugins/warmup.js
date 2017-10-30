const { WARMUP_SOURCE_NAME } = require('../lib/constants')
const PRICING = require('../lib/lambda-pricing')
const { normalizeWarmUpConf } = require('../lib/lambda/warmup')
const WARMUP_FUNCTION_SHORT_NAME = 'warmup'
const WARMUP_FUNCTION_DURATION = 5000
const unitToMillis = {
  minute: 60000,
  hour: 60 * 60000,
  day: 24 * 60 * 60000,
  month: 30 * 24 * 60 * 60000,
  year: 365 * 24 * 60 * 60000,
}

const parseRateExpression = rate => {
  const match = rate.match(/^rate\((\d+)\s(minute|hour|day)s?\)$/)
  if (!match) throw new Error(`failed to parse rate expression: ${rate}`)

  const [val, unit] = match.slice(1)
  return Number(val) * unitToMillis[unit]
}

const getMemorySize = (conf, provider) => {
  return conf.memorySize || provider.memorySize || 128
}

class WarmUp {
  constructor(serverless) {
    this.serverless = serverless
    this.provider = this.serverless.getProvider('aws')
    this.commands = {
      warmup: {
        usage: 'Warm up your functions',
        commands: {
          run: {
            usage: 'Warm up your functions',
            lifecycleEvents: [
              'init',
              'end'
            ],
          },
          cost: {
            usage: 'Estimate the cost of warming up your functions',
            lifecycleEvents: [
              'init',
              'end'
            ],
          }
        }
      }
    }

    this.hooks = {
      'warmup:cost:end': () => Promise.resolve(this.estimateCost()),
      'warmup:run:end': () => Promise.resolve(this.warmUp()),
      'after:deploy:deploy': () => this.afterDeployFunctions()
    }
  }

  getInfo() {
    const { service } = this.serverless
    const { functions, provider } = service
    const warmUpFunctionLongName = service.service + '-' + provider.stage + '-' + WARMUP_FUNCTION_SHORT_NAME
    const event = functions[WARMUP_FUNCTION_SHORT_NAME].events.find(event => event.schedule)
    const { rate, input } = event.schedule
    const period = parseRateExpression(rate)
    return {
      period,
      input,
      functionName: warmUpFunctionLongName
    }
  }

  estimateCost() {
    const { provider, functions } = this.serverless.service
    const info = this.getInfo()
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

    for (let conf of info.input.functions) {
      conf = normalizeWarmUpConf(conf)
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

    this.serverless.cli.consoleLog(`WARNING: the warm-up function itself is likely the greatest expense`)
    this.serverless.cli.consoleLog(`Assuming warm-up function itself takes ${WARMUP_FUNCTION_DURATION}ms to run`)
    this.serverless.cli.consoleLog('')
    this.serverless.cli.consoleLog(`Estimated cost per warm-up operation: $${costs.once}`)
    for (let unit in unitToMillis) {
      this.serverless.cli.consoleLog(`Estimated cost of warm-up per ${unit}: $${costs[unit]}`)
    }

    this.serverless.cli.consoleLog('costs per warmed up function:')
    this.serverless.cli.consoleLog(JSON.stringify(costPerFunction, null, 2))
  }

  warmUp() {
    const { functionName, input } = this.getInfo()
    const params = {
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Qualifier: process.env.SERVERLESS_ALIAS || '$LATEST',
      Payload: JSON.stringify(input)
    }

    return this.provider.request('Lambda', 'invoke', params)
      .then(data => this.serverless.cli.consoleLog('WarmUp: Functions sucessfuly pre-warmed'))
      .catch(error => this.serverless.cli.consoleLog(`WarmUp: Error while pre-warming functions: ${error.stack}`))
  }

  afterDeployFunctions() {
    this.warmUp()
  }
}

module.exports = WarmUp
