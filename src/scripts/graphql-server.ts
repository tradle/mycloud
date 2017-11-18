#!/usr/bin/env node

require('source-map-support').install()

import path = require('path')
import loadDockerEnv = require('node-env-file')
loadDockerEnv(path.resolve(__dirname, '../../docker/.env'))

import { loadCredentials } from '../cli/utils'
import { createRemoteTradle, createTestTradle } from '../'
import express = require('express')
import expressGraphQL = require('express-graphql')
import compression = require('compression')
import cors = require('cors')
import dynogels = require('dynogels')
import { products as createProductsBot } from '../samplebot/strategy'
import sampleQueries from '../samplebot/sample-queries'

const TESTING = process.env.NODE_ENV === 'test'
if (!TESTING) {
  loadCredentials()
  console.log('WARNING: querying remote server')
}

const { bot } = createProductsBot({
  tradle: TESTING ? createTestTradle() : createRemoteTradle()
})

const { port } = require('minimist')(process.argv.slice(2), {
  default: {
    port: 21012
  }
})

const { DYNAMO_ADMIN_PORT } = process.env

const debug = require('debug')('dynogels')
dynogels.log = {
  info: debug,
  warn: debug,
  level: 'info'
}

const app = express()
app.use(cors())
// app.use(express.static(__dirname))
app.use(compression())
app.use('/', expressGraphQL(req => ({
  schema: bot.graphqlAPI.schema,
  graphiql: {
    logo: {
      src: 'https://blog.tradle.io/content/images/2016/08/256x-no-text-1.png',
      width: 32,
      height: 32
    },
    bookmarks: {
      // not supported
      // autorun: true,
      title: 'Samples',
      items: sampleQueries
    }
  },
  pretty: true
})))

app.listen(port)

console.log(`GraphiQL is at http://localhost:${port}`)
console.log(`DynamoDB Admin is at http://localhost:${DYNAMO_ADMIN_PORT}`)
