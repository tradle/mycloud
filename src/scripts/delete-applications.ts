#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

const co = require('co')
const yn = require('yn')
const pick = require('object.pick')
const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    f: 'force'
  }
})

const { loadEnv, loadCredentials, clearTypes } = require('../cli/utils')

loadEnv()
loadCredentials()

// const toDelete = ['tradle.Application']
const { TYPE } = require('@tradle/constants')
const { db, dbUtils, env } = require('../').tradle
const { SERVERLESS_PREFIX } = env
const { clear } = dbUtils
const { models, tables } = require('../samplebot')
const definitions = require('../definitions')
const readline = require('readline')

const deleteApplications = co.wrap(function* () {
  console.log('finding victims...')
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

  const tablesToClear = [definitions.UsersTable.Properties.TableName]
  console.log(`1. will delete the following types: ${JSON.stringify(modelsToDelete, null, 2)}`)
  console.log('2. will also clear the following tables\n', tablesToClear)

  if (!argv.force) {
    const rl = readline.createInterface(process.stdin, process.stdout)
    const answer = yield new Promise(resolve => {
      rl.question('continue? y/[n]:', resolve)
    })

    rl.close()
    if (!yn(answer)) {
      console.log('aborted')
      return
    }
  }

  console.log('let the games begin!')
  const deleteCounts = yield clearTypes({
    types: Object.keys(models)
  })

  console.log(`deleted items count: ${JSON.stringify(deleteCounts, null, 2)}`)

  for (const table of tablesToClear) {
    console.log('clearing', table)
    const numDeleted = yield clear(table)
    console.log(`deleted ${numDeleted} items from ${table}`)
  }
})

deleteApplications().catch(err => {
  console.error(err)
  process.exitCode = 1
})
