const AWS = require('aws-sdk')
const _ = require('lodash')

module.exports = class InitLocal {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.commands = {
      initlocal: {
        commands: {
          reinit: {
            usage: 'force recreate local provider',
            lifecycleEvents: ['start'],
            options: {}
          }
        }
      }
    };

    this.hooks = {
      'initlocalprovider:reinit:start': () => this.forceReinit.bind(this),
      'before:offline:start:init': this.startHandler.bind(this, 'init'),
    };
  }

  forceReinit() {
    require('../lib/test/env').install()
    const { initStack } = require('../lib/cli/utils')
    return initStack({ force: true })
  }

  fixEnv() {
    const region = _.get(this.serverless, 'service.provider.region')
    const profile = _.get(this.serverless, 'service.provider.profile')
    const lambdaDefaultEnvVars = {
      LANG: 'en_US.UTF-8',
      LD_LIBRARY_PATH: '/usr/local/lib64/node-v4.3.x/lib:/lib64:/usr/lib64:/var/runtime:/var/runtime/lib:/var/task:/var/task/lib', // eslint-disable-line max-len
      LAMBDA_TASK_ROOT: '/var/task',
      LAMBDA_RUNTIME_DIR: '/var/runtime',
      AWS_REGION: region,
      AWS_DEFAULT_REGION: region,
      AWS_PROFILE: profile,
      NODE_PATH: '/var/runtime:/var/task:/var/runtime/node_modules',
      IS_OFFLINE: true
    }

    Object.assign(process.env, lambdaDefaultEnvVars)
    AWS.config.update({ region })
    if (profile) {
      AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile })
    }
  }

  startHandler() {
    this.fixEnv()
    require('../lib/test/env').install()
    const { initStack } = require('../lib/cli/utils')
    return initStack()
  }
}
