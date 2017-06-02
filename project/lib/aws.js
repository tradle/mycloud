
const extend = require('xtend/mutable')
const AWS = require('aws-sdk')
const services = process.env.IS_LOCAL ? require('../conf/services.dev') : require('../conf/services.prod')
AWS.config.update(services.AWS)

let s3
let dynamodb
let dynamodbStreams
let docClient
let iot
let iotData
let kms
let lambda
let sts

module.exports = {
  AWS,
  get s3() {
    if (!s3) s3 = new AWS.S3(services.S3)

    return s3
  },
  get dynamodb() {
    if (!dynamodb) dynamodb = new AWS.DynamoDB(services.DynamoDB)

    return dynamodb
  },
  get dynamodbStreams() {
    if (!dynamodbStreams) dynamodbStreams = new AWS.DynamoDBStreams(services.DynamoDBStreams)

    return dynamodbStreams
  },
  get docClient() {
    if (!docClient) docClient = new AWS.DynamoDB.DocumentClient(services.DynamoDB)

    return docClient
  },
  iotData(endpoint) {
    if (!iotData) {
      const opts = extend({ endpoint }, services.Iot || {})
      iotData = new AWS.IotData(opts)
    }

    return iotData
  },
  get iot() {
    if (!iot) iot = new AWS.Iot(services.Iot)

    return iot
  },
  get sts() {
    if (!sts) sts = new AWS.STS(services.STS)

    return sts
  },
  get kms() {
    if (!kms) kms = new AWS.KMS(services.KMS)

    return kms
  },
  get lambda() {
    if (!lambda) lambda = new AWS.Lambda(services.Lambda)

    return lambda
  }
}
