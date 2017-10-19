#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

require('../lib/cli/utils').loadEnv()

const co = require('co')
const yn = require('yn')
const { aws, env, dbUtils } = require('../').tradle
const { listTables, clear } = dbUtils
const readline = require('readline')
const rl = readline.createInterface(process.stdin, process.stdout)

const clearTables = co.wrap(function* () {
  let toClear = yield listTables(env)
  toClear = toClear.filter(name => name !== env.SERVERLESS_PREFIX + 'pubkeys')

  const { href } = aws.dynamodb.endpoint
  console.log(`will empty the following tables at endpoint ${href}\n`, toClear)
  const answer = yield new Promise(resolve => {
    rl.question('continue? y/[n]:', resolve)
  })

  rl.close()
  if (!yn(answer)) {
    console.log('aborted')
    return
  }

  console.log('let the games begin!')
  yield toClear.map(clear)
})

clearTables().catch(err => {
  console.error(err)
  process.exitCode = 1
})
