
const extend = require('xtend/mutable')
const AWS = require('aws-sdk')
const { cachifyPromiser } = require('./utils')
const cacheServices = process.env.IS_LOCAL
const services = process.env.IS_LOCAL
  ? require('../conf/services.dev')
  : require('../conf/services.prod')

AWS.config.update(services.AWS)

let s3
let dynamodb
let dynamodbStreams
let docClient
let iot
let kms
let lambda
let sts

const getIotEndpoint = cachifyPromiser(() => {
  return cache.iot.describeEndpoint().promise()
})

const getIotData = cachifyPromiser(() => {
  return getIotEndpoint().then(({ endpointAddress }) => {
    const opts = extend({ endpoint: endpointAddress }, cache.Iot || {})
    return new AWS.IotData(opts)
  })
})

const cache = {
  AWS,
  get s3() {
    if (!s3 || !cacheServices) s3 = new AWS.S3(services.S3)

    return s3
  },
  get dynamodb() {
    if (!dynamodb || !cacheServices) dynamodb = new AWS.DynamoDB(services.DynamoDB)

    return dynamodb
  },
  get dynamodbStreams() {
    if (!dynamodbStreams || !cacheServices) dynamodbStreams = new AWS.DynamoDBStreams(services.DynamoDBStreams)

    return dynamodbStreams
  },
  get docClient() {
    if (!docClient || !cacheServices) docClient = new AWS.DynamoDB.DocumentClient(services.DynamoDB)

    return docClient
  },
  get iot() {
    if (!iot || !cacheServices) iot = new AWS.Iot(services.Iot)

    return iot
  },
  get sts() {
    if (!sts || !cacheServices) sts = new AWS.STS(services.STS)

    return sts
  },
  get kms() {
    if (!kms || !cacheServices) kms = new AWS.KMS(services.KMS)

    return kms
  },
  get lambda() {
    if (!lambda || !cacheServices) lambda = new AWS.Lambda(services.Lambda)

    return lambda
  },
  getIotData,
  getIotEndpoint
}

module.exports = cache
