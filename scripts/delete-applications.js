#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

const co = require('co')
const yn = require('yn')
const pick = require('object.pick')
const { loadEnv, loadCredentials } = require('../lib/cli/utils')

loadEnv()
loadCredentials()

// const toDelete = ['tradle.Application']
const { TYPE } = require('@tradle/constants')
const { db, dbUtils, env } = require('../').tradle
const { SERVERLESS_PREFIX } = env
const { getModelMap, clear } = dbUtils
const { models, tables } = require('../samplebot')
const definitions = require('../lib/definitions')
const readline = require('readline')

const deleteApplications = co.wrap(function* () {
  console.log('finding victims...')
  const modelMap = getModelMap({ models })
  const modelsToDelete = Object.keys(models).filter(id => {
    const model = models[id]
    if (id === 'tradle.Application' ||
        id === 'tradle.AssignRelationshipManager' ||
        id === 'tradle.Verification' ||
        id === 'tradle.FormRequest') {
      return true
    }

    const { subClassOf } = model
    if (subClassOf === 'tradle.Form' ||
        subClassOf === 'tradle.MyProduct') {
      return true
    }
  })

  const buckets = []
  modelsToDelete.forEach(id => {
    const bucketName = modelMap.models[id]
    if (!buckets.includes(bucketName)) {
      buckets.push(bucketName)
    }
  })

  const tablesToClear = [definitions.UsersTable.Properties.TableName]
  console.log(`1. will delete the following types from tables ${buckets.join(', ')}`,
    JSON.stringify(modelsToDelete, null, 2))

  console.log('2. will also clear the following tables\n', tablesToClear)

  const rl = readline.createInterface(process.stdin, process.stdout)
  const answer = yield new Promise(resolve => {
    rl.question('continue? y/[n]:', resolve)
  })

  rl.close()
  if (!yn(answer)) {
    console.log('aborted')
    return
  }

  console.log('let the games begin!')
  let deleteCounts = {}
  yield Promise.all(buckets.map((tableName) => {
    return dbUtils.forEachItem({
      tableName,
      fn: co.wrap(function* ({ item, tableDescription }) {
        const type = item[TYPE]
        if (!modelsToDelete.includes(type)) return

        const { TableName, KeySchema } = tableDescription.Table
        const keyProps = KeySchema.map(({ AttributeName }) => AttributeName)
        const Key = pick(item, keyProps)
        console.log('deleting item', Key, 'from', TableName)
        if (!deleteCounts[TableName]) {
          deleteCounts[TableName] = {}
        }

        if (deleteCounts[TableName][type]) {
          deleteCounts[TableName][type]++
        } else {
          deleteCounts[TableName][type] = 1
        }

        yield dbUtils.del({ TableName, Key })
      })
    })
  }))

  console.log(`deleted items count: ${JSON.stringify(deleteCounts, null, 2)}`)

  for (const table of tablesToClear) {
    console.log('clearing', table)
    const numDeleted = yield clear(table)
    console.log(`deleted ${numDeleted} items from ${table}`)
  }
})

// const clearTables = co.wrap(function* () {
//   const tables = yield getTablesToClear()
//   console.log('will empty the following tables\n', tables)
//   const rl = readline.createInterface(process.stdin, process.stdout)
//   const answer = yield new Promise(resolve => {
//     rl.question('continue? y/[n]:', resolve)
//   })

//   rl.close()
//   if (!yn(answer)) {
//     console.log('aborted')
//     return
//   }

//   console.log('let the games begin!')
//   for (const table of tables) {
//     console.log('clearing', table)
//     const numDeleted = yield clear(table)
//     console.log(`deleted ${numDeleted} items from ${table}`)
//   }
// })

// clearTables().catch(console.error)

deleteApplications().catch(console.error)
