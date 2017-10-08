#!/usr/bin/env node

const co = require('co')
const yn = require('yn')
// const toDelete = ['tradle.Application']
const { dbUtils, env } = require('../')
const { SERVERLESS_PREFIX } = env
const { listTables, clear } = dbUtils
const { models, tables } = require('../samplebot')
const readline = require('readline');
const promisify = require('pify')
const rl = readline.createInterface(process.stdin, process.stdout)
const confirm = promisify(rl.question.bind(rl))

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

  const names = yield listTables()
  const usersTableName = SERVERLESS_PREFIX + 'users'
  const toDelete = names
    .filter(name => {
      if (name === usersTableName) return true

      const match = tabled.find(item => item.name === name)
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
  const toDelete = yield getTablesToClear()
  console.log('will empty the following tables\n', toDelete)
  const answer = yield confirm('continue? y/[n]:')
  rl.close()
  if (yn(answer)) {
    console.log('aborted')
    return
  }

  console.log('let the games begin!')
  yield toDelete.map(clear)
})

clearTables().catch(console.error)
