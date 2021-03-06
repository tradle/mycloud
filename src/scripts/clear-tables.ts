#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import { loadCredentials } from '../cli/utils'
import { NOT_CLEARABLE_TABLES, clearTables } from '../in-house-bot/murder'

loadCredentials()

import yn from 'yn'
import readline from 'readline'
import { createRemoteBot } from '../'

const bot = createRemoteBot()
const { env, aws } = bot
const { listTables, clear } = bot.dbUtils
const tableToClear = process.argv.slice(2)

const { href } = aws.dynamodb.endpoint
const getTablesToClear = async (tables=process.argv.slice(2)) => {
  if (tables.length) {
    tables = tables.map(name => {
      return name.startsWith(env.STACK_RESOURCE_PREFIX) ? name : env.STACK_RESOURCE_PREFIX + name
    })
  } else {
    tables = await listTables(env)
    tables = tables.filter(name => {
      return !NOT_CLEARABLE_TABLES.find(skippable => env.STACK_RESOURCE_PREFIX + skippable === name)
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

getTablesToClear()
  .then(async (tables) => {
    if (!(tables && tables.length)) return

    await clearTables({ bot, tables })
  })
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
