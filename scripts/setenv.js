#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

const path = require('path')
const co = require('co')
const { loadEnv, loadCredentials } = require('../lib/cli/utils')
const { lambdaUtils } = require('../').tradle
const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    f: 'functions',
    p: 'path'
  }
})

const env = argv.path
  ? require(path.resolve(process.cwd(), argv.path))
  : require('../lib/cli/serverless-yml').custom.brand.env

loadEnv()
loadCredentials()

if (!(env && Object.keys(env).length)) {
  throw new Error('provided env json is empty')
}

console.log('setting env', JSON.stringify(env, null, 2))

co(function* () {
  const functions = argv.functions && argv.functions.split(',').map(f => f.trim())
  yield lambdaUtils.updateEnvironments(function ({ FunctionName }) {
    if (functions && !functions.includes(FunctionName.slice(prefix.length))) {
      console.log('not updating', FunctionName)
      return null
    }

    console.log('updating', FunctionName)
    return env
  })
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
