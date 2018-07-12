
const { StackUtils } = require('../lib/stack-utils')
const vInfo = require('../lib/version')

class SetVersion {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.setVersion = this.setVersion.bind(this)
    this.hooks = {
      'before:package:compileFunctions': this.setVersion
    }
  }

  setVersion() {
    const { dir } = StackUtils.getStackLocation({
      ...process.env,
      SERVERLESS_SERVICE_NAME: this.serverless.service.service,
      SERVERLESS_STAGE: this.options.stage
    })

    this.serverless.service.package.artifactDirectoryName = dir
    return Promise.resolve()
  }
}

module.exports = SetVersion
