#!/usr/bin/env node

const path = require('path')
const loadDockerEnv = require('node-env-file')
loadDockerEnv(path.resolve(__dirname, '../docker/.env'))

const { loadEnv, loadCredentials } = require('../cli/utils')

loadCredentials()

if (process.env.NODE_ENV === 'test') {
  require('../test/env').install()
} else {
  loadEnv()
}

const express = require('express')
const expressGraphQL = require('express-graphql')
const compression = require('compression')
const cors = require('cors')
const dynogels = require('dynogels')
const createProductsBot = require('../bot/strategy').products
const { bot } = createProductsBot()

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
  graphiql: true,
  pretty: true
})))

app.listen(port)

console.log(`GraphiQL is at http://localhost:${port}`)
console.log(`DynamoDB Admin is at http://localhost:${DYNAMO_ADMIN_PORT}`)
