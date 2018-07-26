const { DEFAULT_WARMUP_EVENT } = require('../lib/constants')

class WarmUp {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
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
            options: {
              "functions": {
                "shortcut": "f",
                "usage": "The function(s) to warm up"
              },
              "concurrency": {
                "shortcut": "c",
                "usage": "The concurrency with which to warm up the specified function"
              }
            }
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
      'warmup:run:end': () => Promise.resolve(this.warmUp())
    }
  }

  estimateCost() {
    // lazy require
    const { logger, lambdaUtils } = require('../').createRemoteBot()
    const { unitToMillis } = require('../lib/constants')
    const serverlessYml = require('../lib/cli/serverless-yml')
    const { costs, costPerFunction, warmUpFunctionDuration } = lambdaUtils.estimateCost(serverlessYml)
    logger.info(`WARNING: the warm-up function itself is likely the greatest expense`)
    logger.info(`Assuming warm-up function itself takes ${warmUpFunctionDuration}ms to run`)
    logger.info('')
    logger.info(`Estimated cost per warm-up operation: $${costs.once}`)
    for (let unit in unitToMillis) {
      logger.info(`Estimated cost of warm-up per ${unit}: $${costs[unit]}`)
    }

    logger.info('costs per warmed up function:')
    logger.info(JSON.stringify(costPerFunction, null, 2))
  }

  warmUp() {
    // lazy require
    const { logger, lambdaUtils } = require('../').createRemoteBot()
    const { loadCredentials } = require('../lib/cli/utils')
    const serverlessYml = require('../lib/cli/serverless-yml')

    loadCredentials()

    const { concurrency, functions } = this.options
    let input
    if (functions) {
      input = {
        functions: [].concat(functions),
        concurrency: concurrency || 1
      }
    } else {
      input = DEFAULT_WARMUP_EVENT
    }

    return lambdaUtils.warmUp(input)
      .then(results => {
        results = JSON.stringify(results, null, 2)
        this.serverless.cli.log(`WarmUp: ${results}`)
      })
  }
}

module.exports = WarmUp
