import rawAWS = require('aws-sdk')
import AWSXRay = require('aws-xray-sdk')
import { createConfig } from './aws-config'
if (process.env._X_AMZN_TRACE_ID) {
  console.warn('capturing all http requests with AWSXRay')
  AWSXRay.captureHTTPsGlobal(require('http'))
}

export type AwsApis = {
  s3: AWS.S3,
  dynamodb: AWS.DynamoDB,
  iot: AWS.Iot,
  iotData: AWS.IotData,
  sts: AWS.STS,
  sns: AWS.SNS,
  kms: AWS.KMS,
  docClient: AWS.DynamoDB.DocumentClient,
  lambda: AWS.Lambda,
  cloudformation: AWS.CloudFormation,
  xray: AWS.XRay,
  AWS: any,
  trace: any
}

export default function createAWSWrapper ({ env }) {
  const useXRay = env._X_AMZN_TRACE_ID
  const AWS = useXRay
    ? AWSXRay.captureAWS(rawAWS)
    : rawAWS

  const cacheServices = true// env.IS_LOCAL
  const services = createConfig({ env })
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

  const api:AwsApis = (function () {
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
              // may be set dynamically
              const { IOT_ENDPOINT } = env
              service = new AWS.IotData({
                endpoint: IOT_ENDPOINT,
                ...(services[serviceName] || {})
              })
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

  return api
}
