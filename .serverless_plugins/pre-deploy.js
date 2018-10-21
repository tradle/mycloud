const path = require('path')
const AWS = require('aws-sdk')
const Errors = require('@tradle/errors')
const { StackUtils } = require('../lib/stack-utils')
const {
  validateTemplatesAtPath,
  uploadTemplatesAtPath
} = require('../lib/cli/utils')
const versionInfo = require('../lib/version')
const templatesDir = path.resolve(__dirname, '../cloudformation')

class SetVersion {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('aws')
    this.hooks = {
      'aws:common:validate:validate': () => this.onValidate(),
      'before:package:compileFunctions': () => this.setVersion(),
      'aws:deploy:deploy:uploadArtifacts': async () => {
        // if (!this._uploadedTemplates) {
          await this.uploadTemplates(await this._getBucket())
        // }
      },
    }

    // this._uploadedTemplates = false
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

  async _getBucket() {
    const stage = this._stage()
    const region = this._region()
    try {
      return await this.provider.getServerlessDeploymentBucketName(stage, region)
    } catch (err) {
      Errors.rethrow(err, 'developer')
    }
  }

  _dir() {
    const { dir } = StackUtils.getStackLocationKeys({
      ...process.env,
      service: this._service(),
      stage: this._stage(),
      region: this._region(),
      versionInfo,
    })

    return dir
  }

  async onValidate() {
    await Promise.all([
      this.checkExisting(),
      this.validateTemplates(),
    ])

    // const bucket = await this._getBucket()
    // if (!bucket) return

    // this._uploadedTemplates = true
    // await this.uploadTemplates(bucket)
  }

  async checkExisting() {
    const stage = this._stage()
    const region = this._region()
    const service = this._service()
    const dir = this._dir()
    const StackName = this.provider.naming.getStackName()
    try {
      await this.provider.request(
        'CloudFormation',
        'describeStacks',
        {
          StackName,
        },
        stage,
        region
      )
    } catch (err) {
      if (err.code === 'ValidationError' && err.message.toLowerCase().includes('does not exist')) {
        // if it's a stack create, allow
        return
      }
    }

    const bucketName = await this._getBucket()
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

  _createClient(clName) {
    return new this.provider.sdk[clName](this.provider.getCredentials())
  }

  async validateTemplates() {
    await validateTemplatesAtPath({
      cloudformation: this._createClient('CloudFormation'),
      dir: templatesDir,
    })
  }

  async uploadTemplates(bucket) {
    await uploadTemplatesAtPath({
      s3: this._createClient('S3'),
      dir: templatesDir,
      bucket,
      prefix: this._dir(),
      acl: 'public-read',
    })
  }

  setVersion() {
    this.serverless.service.package.artifactDirectoryName = this._dir()
  }
}

module.exports = SetVersion
