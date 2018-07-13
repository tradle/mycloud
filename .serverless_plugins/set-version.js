
const { StackUtils } = require('../lib/stack-utils')
const versionInfo = require('../lib/version')

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
    const { dir } = StackUtils.getStackLocationKeys({
      ...process.env,
      service: this.serverless.service.service,
      stage: this.options.stage,
      region: this.options.region,
      versionInfo,
    })

    this.serverless.service.package.artifactDirectoryName = dir
    return Promise.resolve()
  }
}

module.exports = SetVersion
