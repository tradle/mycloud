const Errors = require('@tradle/errors')
const { StackUtils } = require('../lib/stack-utils')
const versionInfo = require('../lib/version')

class SetVersion {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('aws')
    this.hooks = {
      'aws:common:validate:validate': () => this.checkExisting(),
      'before:package:compileFunctions': () => this.setVersion()
    }

  }

  _service() {
    return this.serverless.service.service
  }

  _stage() {
    return this.options.stage
  }

  _region() {
    return this.options.region
  }

  _dir() {
    const { dir } = StackUtils.getStackLocationKeys({
      ...process.env,
      service: this._service(),
      stage: this.options.stage,
      region: this.options.region,
      versionInfo,
    })

    return dir
  }

  async checkExisting() {
    const stage = this._stage()
    const region = this._region()
    const service = this._service()
    const dir = this._dir()
    let bucketName
    try {
      bucketName = await this.provider.getServerlessDeploymentBucketName(stage, region)
    } catch (err) {
      Errors.rethrow(err, 'developer')
    }

    if (!bucketName) return

    const { Contents=[] } = await this.provider.request('S3',
      'listObjectsV2',
      {
        Bucket: bucketName,
        Prefix: dir,
      },
      stage,
      region
    )

    if (Contents.length) {
      throw new Error(`already deployed to ${dir}, please deploy from a fresh commit`)
    }
  }

  setVersion() {
    this.serverless.service.package.artifactDirectoryName = this._dir()
  }
}

module.exports = SetVersion
