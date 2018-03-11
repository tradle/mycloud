#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

require('source-map-support').install()

import yn from 'yn'
import _ from 'lodash'

const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    f: 'force'
  }
})

import { loadCredentials } from '../cli/utils'
import { clearApplications, clearTypes, clearUsersTable } from '../in-house-bot/murder'

loadCredentials()

// const toDelete = ['tradle.Application']
import { TYPE } from '@tradle/constants'
import { createRemoteTradle } from '../'
import { customize } from '../in-house-bot/customize'

const tradle = createRemoteTradle()
const bot = require('../bot').createBot({ tradle })
const { db, dbUtils, env } = tradle
const { SERVERLESS_PREFIX } = env
// const { clear } = dbUtils
const readline = require('readline')

const confirmDelete = async (types) => {
  console.log(`1. will delete the following types: ${JSON.stringify(types, null, 2)}`)
  console.log('2. will also clear users table')
  if (!argv.force) {
    const rl = readline.createInterface(process.stdin, process.stdout)
    const answer = await new Promise(resolve => {
      rl.question('continue? y/[n]:', resolve)
    })

    rl.close()
    if (!yn(answer)) {
      console.log('aborted')
      return false
    }
  }

  return true
}

const runclearApplications = async () => {
  await customize({ bot })
  await clearApplications({
    bot,
    confirm: confirmDelete
  })
}

runclearApplications().catch(err => {
  console.error(err)
  process.exitCode = 1
})
