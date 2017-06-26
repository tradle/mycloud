
const extend = require('xtend/mutable')
const AWSXRay = require('aws-xray-sdk')
const rawAWS = require('aws-sdk')
const AWS = process.env.IS_LOCAL ? rawAWS : AWSXRay.captureAWS(rawAWS)
const { cachifyPromiser } = require('./utils')
const cacheServices = process.env.IS_LOCAL
const services = process.env.IS_LOCAL
  ? require('../conf/services.dev')
  : require('../conf/services.prod')

AWS.config.update(services.AWS)

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
api.xray = AWSXRay
api.getIotData = getIotData
api.getIotEndpoint = getIotEndpoint

api.trace = (function () {
  let segment
  return {
    start: function () {
      segment = AWSXRay.getSegment()
    },
    get: function () {
      return segment
    }
  }
}())

module.exports = api
