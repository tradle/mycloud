class WarmUp {
  constructor(serverless) {
    this.serverless = serverless
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

  estimateCost() {
    // lazy require
    const { logger, lambdaUtils } = require('../').createRemoteTradle()
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

  afterDeployFunctions() {
    return this.warmUp()
  }

  warmUp() {
    // lazy require
    const { logger, lambdaUtils } = require('../').createRemoteTradle()
    const { loadCredentials } = require('../lib/cli/utils')
    const serverlessYml = require('../lib/cli/serverless-yml')

    loadCredentials()

    return lambdaUtils.warmUp(lambdaUtils.getWarmUpInfo(serverlessYml).input)
  }
}

module.exports = WarmUp
