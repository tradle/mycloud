#!/usr/bin/env node

require('source-map-support').install()

import path = require('path')
import loadDockerEnv = require('node-env-file')
loadDockerEnv(path.resolve(__dirname, '../../docker/.env'))

import { loadCredentials, loadRemoteEnv } from '../cli/utils'
import dynogels = require('dynogels')
// import { createBot } from '../samplebot/bot'
// import sampleQueries from '../samplebot/sample-queries'

const TESTING = process.env.NODE_ENV === 'test'
if (TESTING) {
  require('../test/env').install()
} else {
  loadCredentials()
  loadRemoteEnv()
  console.log('WARNING: querying remote server')
}

const { port } = require('minimist')(process.argv.slice(2), {
  default: {
    port: require('../cli/serverless-yml').custom['serverless-offline'].port
  }
})

const { DYNAMO_ADMIN_PORT } = process.env

dynogels.log = {
  info: require('debug')('dynogels:info'),
  warn: require('debug')('dynogels:warn'),
  level: 'info'
}

import lambda = require('../samplebot/lambda/http/graphql')
// lambda.execCtx = {
//   event: {}
// }

lambda.koa.listen(port)

console.log(`GraphiQL is at http://localhost:${port}`)
console.log(`DynamoDB Admin is at http://localhost:${DYNAMO_ADMIN_PORT}`)
