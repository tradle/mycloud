#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

const co = require('co')
const yn = require('yn')
const { loadEnv, loadCredentials } = require('../lib/cli/utils')

loadEnv()
loadCredentials()

// const toDelete = ['tradle.Application']
const { dbUtils, env } = require('../').tradle
const { SERVERLESS_PREFIX } = env
const { listTables, clear } = dbUtils
const { models, tables } = require('../samplebot')
const readline = require('readline')
const rl = readline.createInterface(process.stdin, process.stdout)

const getTablesToClear = co.wrap(function* () {
  console.log('looking up tables...')
  const tabled = Object.keys(tables)
    .filter(id => {
      try {
        return tables[id]
      } catch (err) {}
    })
    .map(id => {
      return {
        id,
        name: tables[id].name
      }
    })

  const names = yield listTables(env)
  const usersTableName = SERVERLESS_PREFIX + 'users'
  const toDelete = names.filter(name => {
    if (name === usersTableName) return true

    const match = tabled.find(item => `${SERVERLESS_PREFIX}${item.name}` === name)
    if (!match) return

    const { id } = match
    const model = models[id]
    if (!model) return false

    if (id === 'tradle.Application' ||
        id === 'tradle.AssignRelationshipManager' ||
        id === 'tradle.Verification') {
      return true
    }

    const { subClassOf } = model
    if (subClassOf === 'tradle.Form' ||
        subClassOf === 'tradle.MyProduct') {
      return true
    }
  })

  return toDelete
})

const clearTables = co.wrap(function* () {
  const tables = yield getTablesToClear()
  console.log('will empty the following tables\n', tables)
  const answer = yield new Promise(resolve => {
    rl.question('continue? y/[n]:', resolve)
  })

  rl.close()
  if (!yn(answer)) {
    console.log('aborted')
    return
  }

  console.log('let the games begin!')
  for (const table of tables) {
    console.log('clearing', table)
    const numDeleted = yield clear(table)
    console.log(`deleted ${numDeleted} items from ${table}`)
  }
})

clearTables().catch(console.error)
