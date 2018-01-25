#!/usr/bin/env node

const co = require('co')
const { loadCredentials } = require('../cli/utils')
const { lambdaUtils } = require('../').createRemoteTradle()
let {
  functions,
  key,
  value=null
} = require('minimist')(process.argv.slice(2), {
  alias: {
    k: 'key',
    v: 'value',
    f: 'functions'
  }
})

if (!key) {
  throw new Error('"key" is required')
}

import * as yml from '../cli/serverless-yml'

const { service, custom } = yml
const { stage, prefix } = custom
loadCredentials()

co(function* () {
  if (functions) {
    functions = functions.split(',').map(f => f.trim())
  }

  const update = {
    [key]: value == null ? null : '' + value
  }

  console.log('setting', update)
  yield lambdaUtils.updateEnvironments(function ({ FunctionName }) {
    if (functions && !functions.includes(FunctionName.slice(prefix.length))) return null

    return update
  })
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
