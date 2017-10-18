#!/usr/bin/env node

process.env.IS_LOCAL = true

const co = require('co')
const yn = require('yn')
const { env, dbUtils } = require('../').tradle
const { listTables, clear } = dbUtils
const readline = require('readline')
const rl = readline.createInterface(process.stdin, process.stdout)

const clearTables = co.wrap(function* () {
  let toClear = yield listTables(env)
  toClear = toClear.filter(name => name !== env.SERVERLESS_PREFIX + 'pubkeys')

  console.log('will empty the following tables\n', toClear)
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
