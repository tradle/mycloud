#!/usr/bin/env node

require('source-map-support').install()

import path from 'path'
import loadDockerEnv from 'node-env-file'
loadDockerEnv(path.resolve(__dirname, '../../docker/.env'))

import { loadCredentials, loadRemoteEnv } from '../cli/utils'
import dynogels from 'dynogels'
// import { createBot } from '../in-house-bot/bot'
// import sampleQueries from '../in-house-bot/sample-queries'

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

import lambda from '../in-house-bot/lambda/http/graphql'
// lambda.execCtx = {
//   event: {}
// }

lambda.koa.listen(port)

console.log(`GraphiQL is at http://localhost:${port}`)
console.log(`DynamoDB Admin is at http://localhost:${DYNAMO_ADMIN_PORT}`)
