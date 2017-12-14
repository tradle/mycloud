#!/usr/bin/env node

import { loadCredentials, cloneRemoteTable } from '../cli/utils'

const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    s: 'source',
    d: 'destination'
  }
})

const { source, destination } = argv
if (!(source && destination)) {
  throw new Error('expected "source" and "destination"')
}

loadCredentials()

cloneRemoteTable({ source, destination }).catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
