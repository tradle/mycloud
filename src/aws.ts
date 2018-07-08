import rawAWS from 'aws-sdk'
import AWSXRay from 'aws-xray-sdk-core'
import { createConfig } from './aws-config'
import { isXrayOn } from './utils'
import { Env, Logger } from './types'

const willUseXRay = isXrayOn()
if (willUseXRay) {
  console.warn('capturing all http requests with AWSXRay')
  AWSXRay.captureHTTPsGlobal(require('http'))
}

export type AwsApis = {
  s3: AWS.S3,
  dynamodb: AWS.DynamoDB,
  iam: AWS.IAM,
  iot: AWS.Iot,
  iotData: AWS.IotData,
  sts: AWS.STS,
  sns: AWS.SNS,
  ses: AWS.SES,
  kms: AWS.KMS,
  docClient: AWS.DynamoDB.DocumentClient,
  lambda: AWS.Lambda,
  cloudformation: AWS.CloudFormation,
  xray: AWS.XRay,
  apigateway: AWS.APIGateway,
  ssm: AWS.SSM,
  AWS: any,
  trace: any
}

export default function createAWSWrapper ({ env, logger }: {
  env: Env
  logger: Logger
}) {
  const AWS = willUseXRay
    ? AWSXRay.captureAWS(rawAWS)
    : rawAWS

  AWS.config.correctClockSkew = true

  const cacheServices = true
  const services = createConfig({ env })
  AWS.config.update(services)

  const instanceNameToServiceName = {
    s3: 'S3',
    dynamodb: 'DynamoDB',
    dynamodbStreams: 'DynamoDBStreams',
    docClient: 'DocumentClient',
    iam: 'IAM',
    iot: 'Iot',
    sts: 'STS',
    sns: 'SNS',
    ses: 'SES',
    kms: 'KMS',
    lambda: 'Lambda',
    iotData: 'Iot',
    xray: 'XRay',
    apigateway: 'APIGateway',
    ssm: 'SSM',
    cloudformation: 'CloudFormation'
  }

  const useGlobalConfigClock = service => {
    if (service instanceof AWS.DynamoDB.DocumentClient) {
      service = service.service
    }

    if (!service.config) return

    Object.defineProperty(service.config, 'systemClockOffset', {
      get() {
        return AWS.config.systemClockOffset
      },
      set(value) {
        logger.warn(`setting systemClockOffset: ${value}`)
        AWS.config.systemClockOffset = value
      }
    })
  }

  const api:any = (function () {
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
            const lServiceName = serviceName.toLowerCase()
            const conf = services[lServiceName] || {}
            if (instanceName === 'docClient') {
              service = new AWS.DynamoDB.DocumentClient(services.dynamodb)
            } else if (instanceName === 'iotData') {
              // may be set dynamically
              const { IOT_ENDPOINT } = env
              service = new AWS.IotData({
                endpoint: IOT_ENDPOINT,
                ...conf
              })
            } else {
              if (env.TESTING && !services[lServiceName] && lServiceName !== 'iot') {
                // don't pretend to support it as this will result
                // in calling the remote service!
                return null
              }

              service = new AWS[serviceName](conf)
            }
          }

          useGlobalConfigClock(service)
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

  return api as AwsApis
}

export { createAWSWrapper }
