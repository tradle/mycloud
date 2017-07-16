#!/usr/bin/env node

const path = require('path')
const co = require('co')
const promisify = require('pify')
const { exec } = promisify(require('child_process'))
const fs = promisify(require('fs'))
const { prettify } = require('../project/lib/string-utils')
const { getConfiguration } = require('../project/lib/lambda-utils')
const envPath = path.join(process.cwd(), 'env.json')
const serviceMapPath = path.join(process.cwd(), 'service-map.json')
let env
try {
  env = require(envPath)
} catch (err) {
  env = {}
}

co(function* () {
  const props = yield {
    ACCOUNT_ID: exec('aws sts get-caller-identity --output text --query Account'),
    // IOT_ENDPOINT: exec('aws iot describe-endpoint --output text')
    //   // .then(endpoint => `https://${endpoint}`)
  }

  for (let prop in props) {
    env[prop] = props[prop].toString().trim()
  }

  yield fs.writeFile(envPath, prettify(env), { encoding: 'utf8' })
}).catch(console.error)

co(function* () {
  const { Environment } = yield getConfiguration('tradle-dev-setenvvars')
  yield fs.writeFile(serviceMapPath, prettify(Environment.Variables))
}).catch(console.error)
