
const extend = require('xtend/mutable')
const AWSXRay = require('aws-xray-sdk')
const rawAWS = require('aws-sdk')
const AWS = process.env.IS_LOCAL || !process.env.IS_LAMBDA_ENVIRONMENT
  ? rawAWS
  : AWSXRay.captureAWS(rawAWS)

const cacheServices = process.env.IS_LOCAL
const services = require('./aws-config')
AWS.config.update(services)

const instanceNameToServiceName = {
  s3: 'S3',
  dynamodb: 'DynamoDB',
  dynamodbStreams: 'DynamoDBStreams',
  docClient: 'DocumentClient',
  iot: 'Iot',
  sts: 'STS',
  kms: 'KMS',
  lambda: 'Lambda',
  iotData: 'Iot',
  cloudformation: 'CloudFormation'
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
          } else if (instanceName === 'iotData') {
            const { IOT_ENDPOINT } = require('./env')
            const opts = extend({
              endpoint: IOT_ENDPOINT
            }, services[serviceName] || {})

            service = new AWS.IotData(opts)
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
