const { WARMUP_SOURCE_NAME } = require('../lib/constants')
const warmUpFunctionShortName = 'warmup'

class WarmUp {
  constructor(serverless) {
    this.serverless = serverless
    this.provider = this.serverless.getProvider('aws')
    this.commands = {
      warmup: {
        usage: 'Warm up your functions',
        lifecycleEvents: [
          'warmup'
        ]
      }
    }

    this.hooks = {
      'warmup:warmup': () => Promise.resolve(this.warmUp()),
      'after:deploy:deploy': () => this.afterDeployFunctions()
    }
  }

  warmUp() {
    const { service } = this.serverless
    const { functions, provider } = service
    const warmUpFunctionLongName = service.service + '-' + provider.stage + '-' + warmUpFunctionShortName
    const event = functions[warmUpFunctionShortName].events.find(event => event.schedule)
    const { input } = event.schedule
    const params = {
      FunctionName: warmUpFunctionLongName,
      InvocationType: 'RequestResponse',
      LogType: 'None',
      Qualifier: process.env.SERVERLESS_ALIAS || '$LATEST',
      Payload: JSON.stringify(input)
    }

    return this.provider.request('Lambda', 'invoke', params)
      .then(data => this.serverless.cli.log('WarmUp: Functions sucessfuly pre-warmed'))
      .catch(error => this.serverless.cli.log('WarmUp: Error while pre-warming functions', error))
  }

  afterDeployFunctions() {
    this.warmUp()
  }
}

module.exports = WarmUp
