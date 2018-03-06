#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import yn from 'yn'
import readline from 'readline'
const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    f: 'force',
    t: 'types'
  }
})

import { loadCredentials, clearTypes } from '../cli/utils'

loadCredentials()

import { createRemoteTradle } from '../'

const tradle = createRemoteTradle()

;(async () => {
  const types = (argv.types || '').split(',').map(str => str.trim())
  if (!types.length) {
    throw new Error('expected "types" comma-separated list')
  }

  console.log('will delete types:', types.join(','))
  if (!argv.force) {
    const rl = readline.createInterface(process.stdin, process.stdout)
    const answer = await new Promise(resolve => {
      rl.question('continue? y/[n]:', resolve)
    })

    rl.close()
    if (!yn(answer)) {
      console.log('aborted')
      return
    }
  }

  clearTypes({ tradle, types })
})()
.catch(err => {
  console.error(err)
  process.exitCode = 1
})
