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
      'before:offline:start:init': this.startHandler.bind(this),
      'before:offline:start': this.startHandler.bind(this)
    };
  }

  forceReinit() {
    require('../lib/test/env').install()
    const { initializeProvider } = require('../lib/cli/utils')
    return initializeProvider({ force: true })
  }

  startHandler() {
    require('../lib/test/env').install()
    const { initializeProvider } = require('../lib/cli/utils')
    return initializeProvider()
  }
}
