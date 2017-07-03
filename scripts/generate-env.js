#!/usr/bin/env node

const path = require('path')
const co = require('co').wrap
const promisify = require('pify')
const { exec } = promisify(require('child_process'))
const fs = promisify(require('fs'))
const envPath = path.join(process.cwd(), 'env.json')
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

  yield fs.writeFile(envPath, JSON.stringify(env, null, 2), { encoding: 'utf8' })
})()

