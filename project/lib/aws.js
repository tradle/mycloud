
const extend = require('xtend/mutable')
const AWS = require('aws-sdk')
const { cachifyPromiser } = require('./utils')
const cacheServices = process.env.IS_LOCAL
const services = process.env.IS_LOCAL
  ? require('../conf/services.dev')
  : require('../conf/services.prod')

AWS.config.update(services.AWS)

// let s3
// let dynamodb
// let dynamodbStreams
// let docClient
// let iot
// let kms
// let lambda
// let sts

const getIotEndpoint = cachifyPromiser(() => {
  return api.iot.describeEndpoint().promise()
})

const getIotData = cachifyPromiser(() => {
  return getIotEndpoint().then(({ endpointAddress }) => {
    const opts = extend({ endpoint: endpointAddress }, services.Iot || {})
    return new AWS.IotData(opts)
  })
})

const instanceNameToServiceName = {
  s3: 'S3',
  dynamodb: 'DynamoDB',
  dynamodbStreams: 'DynamoDBStreams',
  docClient: 'DocumentClient',
  iot: 'Iot',
  sts: 'STS',
  kms: 'KMS',
  lambda: 'Lambda'
}

const api = (function () {
  const cachedServices = {}
  Object.keys(instanceNameToServiceName).forEach(instanceName => {
    const serviceName = instanceNameToServiceName[instanceName]
    let service
    Object.defineProperty(cachedServices, instanceName, {
      set: function (value) {
        service = value
      },
      get: function () {
        if (!service || !cacheServices) {
          if (instanceName === 'docClient') {
            service = new AWS.DynamoDB.DocumentClient(services.DynamoDB)
          } else {
            service = new AWS[serviceName](services[serviceName])
          }
        }

        return service
      }
    })
  })

  return cachedServices
}())

api.AWS = AWS
api.getIotData = getIotData
api.getIotEndpoint = getIotEndpoint

module.exports = api

  // set s3(value) {
  //   s3 = value
  // }
  // get s3 () {
  //   if (!s3 || !cacheServices) s3 = new AWS.S3(services.S3)

  //   return s3
  // },
  // set dynamodb(value) {
  //   s3 = value
  // }
  // get dynamodb () {
  //   if (!dynamodb || !cacheServices) dynamodb = new AWS.DynamoDB(services.DynamoDB)

  //   return dynamodb
  // },
  // get dynamodbStreams () {
  //   if (!dynamodbStreams || !cacheServices) dynamodbStreams = new AWS.DynamoDBStreams(services.DynamoDBStreams)

  //   return dynamodbStreams
  // },
  // get docClient () {
  //   if (!docClient || !cacheServices) docClient = new AWS.DynamoDB.DocumentClient(services.DynamoDB)

  //   return docClient
  // },
  // get iot () {
  //   if (!iot || !cacheServices) iot = new AWS.Iot(services.Iot)

  //   return iot
  // },
  // get sts () {
  //   if (!sts || !cacheServices) sts = new AWS.STS(services.STS)

  //   return sts
  // },
  // get kms () {
  //   if (!kms || !cacheServices) kms = new AWS.KMS(services.KMS)

  //   return kms
  // },
  // get lambda () {
  //   if (!lambda || !cacheServices) lambda = new AWS.Lambda(services.Lambda)

  //   return lambda
  // },
// }
