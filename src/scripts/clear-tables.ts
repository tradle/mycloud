#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import { loadCredentials, clearUsersTable } from '../cli/utils'

loadCredentials()

import yn from 'yn'
import readline from 'readline'
import { createRemoteTradle } from '../'

const { aws, env, dbUtils } = createRemoteTradle()
const { listTables, clear } = dbUtils
const tableToClear = process.argv.slice(2)
const skip = [
  'pubkeys',
  'presence',
  'events',
  'seals',
  'friends'
]

const { href } = aws.dynamodb.endpoint
const getTablesToClear = async (tables=process.argv.slice(2)) => {
  if (tables.length) {
    tables = tables.map(name => {
      return name.startsWith(env.SERVERLESS_PREFIX) ? name : env.SERVERLESS_PREFIX + name
    })
  } else {
    tables = await listTables(env)
    tables = tables.filter(name => {
      return !skip.find(skippable => env.SERVERLESS_PREFIX + skippable === name)
    })
  }

  console.log(`will empty the following tables at endpoint ${href}\n`, tables)
  const rl = readline.createInterface(process.stdin, process.stdout)
  const answer = await new Promise(resolve => {
    rl.question('continue? y/[n]:', resolve)
  })

  rl.close()
  if (!yn(answer)) {
    console.log('aborted')
    return
  }

  return tables
}

const clearTables = async () => {
  const tables = await getTablesToClear()
  if (!(tables && tables.length)) return

  console.log(`will empty the following tables at endpoint ${href}\n`, tables)
  console.log('let the games begin!')
  for (const table of tables) {
    if (/-users/.test(table)) {
      await clearUsersTable(dbUtils)
    }

    console.log('clearing', table)
    const numDeleted = await clear(table)
    console.log(`deleted ${numDeleted} items from ${table}`)
  }

  console.log('done!')
}

clearTables().catch(err => {
  console.error(err)
  process.exitCode = 1
})
