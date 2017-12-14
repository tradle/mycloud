#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

const { loadCredentials } = require('../cli/utils')

loadCredentials()

const co = require('co')
const yn = require('yn')
const { aws, env, dbUtils } = require('../').tradle
const { listTables, clear } = dbUtils
const readline = require('readline')
const tableToClear = process.argv.slice(2)
const skip = [
  'pubkeys',
  'presence',
  'events',
  'seals',
  'tradle_MyCloudFriend'
]

const { href } = aws.dynamodb.endpoint
const getTablesToClear = co.wrap(function* (tables=process.argv.slice(2)) {
  if (tables.length) {
    tables = tables.map(name => {
      return name.startsWith(env.SERVERLESS_PREFIX) ? name : env.SERVERLESS_PREFIX + name
    })
  } else {
    tables = yield listTables(env)
    tables = tables.filter(name => {
      return !skip.find(skippable => env.SERVERLESS_PREFIX + skippable === name)
    })
  }

  console.log(`will empty the following tables at endpoint ${href}\n`, tables)
  const rl = readline.createInterface(process.stdin, process.stdout)
  const answer = yield new Promise(resolve => {
    rl.question('continue? y/[n]:', resolve)
  })

  rl.close()
  if (!yn(answer)) {
    console.log('aborted')
    return
  }

  return tables
})

const clearTables = co.wrap(function* () {
  const tables = yield getTablesToClear()
  if (!(tables && tables.length)) return

  console.log(`will empty the following tables at endpoint ${href}\n`, tables)
  console.log('let the games begin!')
  for (const table of tables) {
    console.log('clearing', table)
    const numDeleted = yield clear(table)
    console.log(`deleted ${numDeleted} items from ${table}`)
  }

  console.log('done!')
})

clearTables().catch(err => {
  console.error(err)
  process.exitCode = 1
})
