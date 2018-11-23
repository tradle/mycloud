const fs = require('fs')
const path = require('path')
const AWS = require('aws-sdk')
const _ = require('lodash')
const Errors = require('@tradle/errors')
const { traverse, replaceDeep } = require('../lib/utils')
const { StackUtils } = require('../lib/stack-utils')
const { Deployment } = require('../lib/in-house-bot/deployment')
const {
  validateTemplatesAtPath,
  uploadTemplatesAtPath
} = require('../lib/cli/utils')
const versionInfo = require('../lib/version')
const templatesDir = path.resolve(__dirname, '../cloudformation')
const stackParameters = require('../vars').stackParameters || require('../default-vars').stackParameters

const CODE_BUCKET_PATH = ['Properties', 'Code', 'S3Bucket']
const CF_REF_REST_API = { Ref: 'ApiGatewayRestApi' }
const CF_ATT_REST_API_ROOT = {
  'Fn::GetAtt': [
    'ApiGatewayRestApi',
    'RootResourceId'
  ]
}

const replaceDeploymentBucketRefs = (template, replacement) => {
  StackUtils.getResourcesByType(template, 'AWS::Lambda::Function').forEach(resource => {
    _.set(resource, CODE_BUCKET_PATH, replacement)
  })

  // otherwise serverless uses { Ref: 'ServerlessDeploymentBucket' }
  // which may not exist
  template.Outputs.ServerlessDeploymentBucketName = _.cloneDeep(template.Outputs.DeploymentBucket)
}

const PATH_TO_SOURCE = 'Resources.Source'
const replaceDeepExceptInSourcePath = (template, match, replacement) => {
  traverse(template).forEach(function(value) {
    if (_.isEqual(value, match) && !this.path.join('.').startsWith(PATH_TO_SOURCE)) {
      this.update(replacement)
    }
  })
}

const replaceApiGatewayRestApiRefs = (template, replacement) => {
  return replaceDeepExceptInSourcePath(template, CF_REF_REST_API, replacement)
}

const replaceApiGatewayRestApiRootRefs = (template, replacement) => {
  return replaceDeepExceptInSourcePath(template, CF_ATT_REST_API_ROOT, replacement)
}

class SetVersion {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.provider = this.serverless.getProvider('aws')
    this.hooks = {
      'aws:common:validate:validate': () => this.onValidate(),
      'before:package:compileFunctions': () => this.setVersion(),
      'before:aws:package:finalize:saveServiceState': () => this.onTemplateFinalized(),
      // 'before:aws:deploy:deploy:uploadArtifacts': () => this.onTemplateFinalized(),
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
    return versionInfo.templatesPath
  }

  async onTemplateFinalized() {
    await Promise.all([
      this._getBucket().then(bucket => this.uploadTemplates(bucket)),
      this.setTemplateParameters()
    ])

    this.replaceDeploymentBucketRefs()
  }

  replaceDeploymentBucketRefs() {
    const { provider } = this.serverless.service
    const template = provider.compiledCloudFormationTemplate
    const params = provider.cloudformationTemplateParameters
    // const sourceDeploymentBucket = params.find(p => p.ParameterKey === 'SourceDeploymentBucket' && p.ParameterValue)
    //   ? { Ref: 'SourceDeploymentBucket' }
    //   : { 'Fn::GetAtt': 'Buckets.Outputs.Deployment' }

    // StackUtils.replaceDeploymentBucketRefs(template, sourceDeploymentBucket)
    replaceDeploymentBucketRefs(template, {
      'Fn::GetAtt': 'Source.Outputs.SourceDeploymentBucket'
    })

    replaceApiGatewayRestApiRefs(template, {
      'Fn::GetAtt': 'Source.Outputs.ApiGatewayRestApi'
    })

    replaceApiGatewayRestApiRootRefs(template, {
      'Fn::GetAtt': 'Source.Outputs.ApiGatewayRestApiRootResourceId'
    })

    this.log('WARNING: removing duplicate ServiceEndpoint definition (ours and serverless\'s)')
    template.Outputs.ServiceEndpoint.Value = _.pick(template.Outputs.ServiceEndpoint.Value, ['Fn::Sub'])

    Deployment.ensureInitLogIsRetained(template)
  }

  async setTemplateParameters() {
    const parameterNames = Object.keys(this.serverless.service.provider.compiledCloudFormationTemplate.Parameters)
    let params = []
    try {
      const { Parameters } = await this.getStackInfo()
      params = Parameters
    } catch (err) {
      Errors.ignore(err, /not found|does not exist/)
    }

    Object.keys(stackParameters).forEach(key => {
      if (!parameterNames.includes(key)) {
        this.log(`WARNING: parameter "${key}" specified in "stackParameters" was not found in the template`)
        return
      }

      const param = params.find(({ ParameterKey }) => ParameterKey === key)
      const value = stackParameters[key]
      if (param && param.ParameterValue === value) return

      if (param) {
        this.log(`WARNING: overriding parameter ${key} from vars`)
        param.ParameterValue = value
      } else {
        this.log(`WARNING: adding parameter ${key} from vars`)
        params.push({
          ParameterKey: key,
          ParameterValue: value,
        })
      }
    })

    this.serverless.service.provider.cloudformationTemplateParameters = params
  }

  async onValidate() {
    await Promise.all([
      this.checkExisting(),
      this.validateTemplates(),
    ])
  }

  async getStackInfo() {
    const { Stacks } = await this.provider.request(
      'CloudFormation',
      'describeStacks',
      {
        StackName: this.provider.naming.getStackName(),
      },
      this._stage(),
      this._region(),
    )

    return Stacks[0]
  }

  async checkExisting() {
    const stage = this._stage()
    const region = this._region()
    const service = this._service()
    const dir = this._dir()
    try {
      await this.getStackInfo()
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

    const hasZip = Contents.find(item => item.Key.endsWith('.zip'))
    if (hasZip) {
      throw new Error(`already deployed to ${dir}, please deploy from a fresh commit`)
    }
  }

  _createClient(clName) {
    return new this.provider.sdk[clName](this.provider.getCredentials())
  }

  log(...args) {
    this.serverless.cli.log(...args)
  }

  async validateTemplates() {
    await validateTemplatesAtPath({
      cloudformation: this._createClient('CloudFormation'),
      dir: templatesDir,
    })
  }

  async uploadTemplates(bucket) {
    if (!bucket) {
      throw new Error(`can't upload template, don't know target bucket`)
    }

    const prefix = this._dir()

    this.log(`uploading templates to s3://${bucket}/${prefix}`)

    await uploadTemplatesAtPath({
      s3: this._createClient('S3'),
      dir: templatesDir,
      bucket,
      prefix,
      acl: 'public-read',
    })
  }

  setVersion() {
    this.serverless.service.package.artifactDirectoryName = this._dir()
  }
}

module.exports = SetVersion
