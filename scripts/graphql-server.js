#!/usr/bin/env node

const path = require('path')
const loadEnv = require('node-env-file')
loadEnv(path.resolve(__dirname, '../docker/.env'))

require('../test/env')

const express = require('express')
const expressGraphQL = require('express-graphql')
const compression = require('compression')
const cors = require('cors')
const dynogels = require('dynogels')
const { createSchema } = require('@tradle/schema-graphql')
const { createResolvers, createTables } = require('@tradle/dynamodb')
const { objects, env } = require('../')
const { createProductsBot } = require('../test/end-to-end')
const { bot, productsAPI } = createProductsBot()

const { port } = require('minimist')(process.argv.slice(2), {
  default: {
    port: 4000
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
