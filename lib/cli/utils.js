
const promisify = require('pify')
const proc = promisify(require('child_process'))
const fs = promisify(require('fs'))
const co = require('co').wrap
const YAML = require('js-yaml')
const extend = require('xtend/mutable')
const debug = require('debug')('tradle:sls:cli:utils')
const prettify = obj => JSON.stringify(obj, null, 2)

const {
  addResourcesToEnvironment,
  addResourcesToOutputs,
  removeResourcesThatDontWorkLocally,
} = require('./compile')

const getStackName = () => {
  const {
    service,
    provider: { stage }
  } = require('./serverless-yml')

  return `${service}-${stage}`
}

const getStackResources = () => {
  const { lambdaUtils } = require('../').tradle
  return lambdaUtils.getStackResources(getStackName())
}

const getPhysicalId = co(function* (logicalId) {
  const resources = yield getStackResources()
  const match = resources.find(({ LogicalResourceId }) => LogicalResourceId === logicalId)
  if (!match) {
    const list = resources.map(({ LogicalResourceId }) => LogicalResourceId)
    throw new Error(`resource with logical id "${logicalId}" not found. See list of resources in stack: ${JSON.stringify(list)}`)
  }

  return match.PhysicalResourceId
})

const genLocalResources = co(function* (tradle) {
  if (!tradle) tradle = require('../').tradle

  const { aws, init } = tradle
  const { s3 } = aws
  const { ensureInitialized } = init
  const yml = require('./serverless-yml')
  const { resources } = yml
  const { Resources } = resources
  const tables = []
  const buckets = []
  Object.keys(Resources)
    .filter(name => Resources[name].Type === 'AWS::DynamoDB::Table')
    .forEach(name => {
      const { Type, Properties } = Resources[name]
      if (Properties.StreamSpecification) {
        Properties.StreamSpecification.StreamEnabled = true
      }

      tables.push(
        aws.dynamodb.createTable(Properties).promise()
          .then(result => debug(`created table: ${name}, ${prettify(result)}`))
          .catch(err => {
            if (err.name !== 'ResourceInUseException') {
              throw err
            }
          })
      )
    })

  Object.keys(Resources)
    .filter(name => Resources[name].Type === 'AWS::S3::Bucket')
    .forEach(name => {
      buckets.push(
        aws.s3.createBucket({
          Bucket: tradle.prefix + name.toLowerCase()
        })
        .promise()
        .then(result => debug(`created bucket: ${name}, ${prettify(result)}`))
      )
    })

  yield buckets
  yield tables
  yield ensureInitialized()
})

const makeDeploymentBucketPublic = co(function* () {
  loadCredentials()

  const { s3 } = require('../').tradle.aws
  const serverlessYml = require('./serverless-yml')
  const { service, custom } = serverlessYml
  const { Buckets } = yield s3.listBuckets().promise()
  const Bucket = Buckets.find(bucket => {
    return new RegExp(`${service}-${custom.stage}-serverlessdeploymentbucket`)
      .test(bucket.Name)
  }).Name

  yield makePublic(Bucket)
})

const makePublic = co(function* (Bucket) {
  loadCredentials()

  const { s3 } = require('../').tradle.aws
  yield s3.putBucketPolicy({
    Bucket,
    Policy: `{
      "Version": "2012-10-17",
      "Statement": [{
        "Sid": "MakeItPublic",
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::${Bucket}/*"
      }]
    }`
  }).promise()

  // yield s3.putBucketAcl({
  //   Bucket,
  //   ACL: 'public-read'
  // }).promise()
})

const interpolateTemplate = co(function* (argStr) {
  const command = `sls print ${argStr}`
  return proc.exec(command, {
    cwd: process.cwd()
  })
  .then(buf => buf.toString())
})

const compileTemplate = co(function* (path) {
  const file = yield fs.readFile(path, { encoding: 'utf8' })
  const yaml = YAML.load(file)
  const isLocal = process.env.IS_LOCAL
  if (isLocal) {
    removeResourcesThatDontWorkLocally(yaml)
  }

  addResourcesToEnvironment(yaml)
  addResourcesToOutputs(yaml)
  return YAML.dump(yaml)
})

function loadCredentials () {
  const AWS = require('aws-sdk')
  const yml = require('./serverless-yml')
  const { profile } = yml.provider
  AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile })
}

function loadEnv () {
  const { env } = require('../').tradle
  const yml = require('./serverless-yml')
  const { environment } = yml.provider
  env.set(environment)
}

module.exports = {
  loadEnv,
  compileTemplate,
  interpolateTemplate,
  genLocalResources,
  makeDeploymentBucketPublic,
  loadCredentials,
  getStackName,
  getStackResources,
  getPhysicalId
}
