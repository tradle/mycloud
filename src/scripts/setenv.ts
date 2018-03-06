#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = 'false'

import path from 'path'
import { loadCredentials } from '../cli/utils'
import { createRemoteTradle } from '../'

const { stackUtils } = createRemoteTradle()
const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    f: 'functions',
    p: 'path'
  }
})

const yml = require('../cli/serverless-yml')
const { custom, provider } = yml
const env = argv.path
  ? require(path.resolve(process.cwd(), argv.path))
  : minusObjectValues(provider.environment)

loadCredentials()

if (!(env && Object.keys(env).length)) {
  throw new Error('provided env json is empty')
}

console.log('setting env', JSON.stringify(env, null, 2))

;(async () => {
  const functions = argv.functions && argv.functions.split(',').map(f => f.trim())
  await stackUtils.updateEnvironments(function ({ FunctionName }) {
    if (functions && !functions.includes(FunctionName.slice(custom.prefix.length))) {
      console.log('not updating', FunctionName)
      return null
    }

    console.log('updating', FunctionName)
    return env
  })
})()
.catch(err => {
  console.error(err)
  process.exit(1)
})

function minusObjectValues (obj) {
  const minus = {}
  for (let key in obj) {
    let val = obj[key]
    if (typeof val !== 'object') {
      minus[key] = val
    }
  }

  return minus
}
