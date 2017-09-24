const co = require('co')
const extend = require('xtend/mutable')
const debug = require('debug')('tradle:sls:cli:utils')
const serverlessYml = require('./serverless-yml')
const { service, custom } = serverlessYml
const stack = require('./stack')
const tradle = require('../')
const { env, aws, resources, init } = tradle
const { s3 } = aws
const { ensureInitialized } = init
const genLocalResources = co.wrap(function* () {
  const { Resources } = stack
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
          .then(() => debug(`created table: ${name}`))
          .catch(err => {
            if (err.name !== 'ResourceInUseException') {
              throw err
            }
          })
      )
    })

  Object.keys(resources.Bucket).forEach(name => {
    const Bucket = resources.Bucket[name]
    buckets.push(
      aws.s3.createBucket({ Bucket }).promise()
        .then(() => debug(`created bucket: ${name}`))
    )
  })

  yield buckets
  yield tables
  yield ensureInitialized()
})

function* makeDeploymentBucketPublic () {
  const { Buckets } = yield s3.listBuckets().promise()
  const Bucket = Buckets.find(bucket => {
    return new RegExp(`${service}-${custom.stage}-serverlessdeploymentbucket`)
      .test(bucket.Name)
  }).Name

  yield makePublic(Bucket)
}

function* makePublic (Bucket) {
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
}

module.exports = {
  genLocalResources
}
