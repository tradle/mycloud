#!/usr/bin/env node

import path = require('path')
import fs = require('fs')
if (!fs.existsSync(path.resolve(process.cwd(), 'vars.yml'))) {
  throw new Error('expected vars.yml file')
}

import promisify = require('pify')
import _proc = require('child_process')
import { omit } from 'lodash'

const proc = promisify(_proc)
const expectedNodeVersion = 'v6.10.3'
if (process.version !== expectedNodeVersion) {
  throw new Error(`expected Node.js ${expectedNodeVersion}, you're running ${process.version}`)
}

// some bug, otherwise you could just run sls deploy
// https://forum.serverless.com/t/feature-branching-and-aws-apigateway-name/1890

// proc.execSync('npm run build:yml', {
//   cwd: process.cwd(),
//   stdio: 'inherit',
//   env: omit(process.env, ['SLS_DEBUG', 'DEBUG'])
// })

const yml = require('../cli/serverless-yml')
const stage = process.argv[2] || yml.custom.stage
if (!/^[a-zA-Z-_]+$/.test(stage)) {
  throw new Error('invalid stage: ' + stage)
}

let command = `sls deploy --stage=${stage}`

;(async () => {
  try {
    const pathToNtfy = await proc.exec('which ntfy', {
      cwd: process.cwd(),
      stdio: 'inherit'
    })

    if (pathToNtfy) {
      command = 'ntfy done ' + command
    }
  } catch (err) {}

  console.log(command)
  proc.execSync(command, {
    cwd: process.cwd(),
    stdio: 'inherit'
  })
})()
.catch(err => {
  console.error(err)
  process.exitCode = 1
})
