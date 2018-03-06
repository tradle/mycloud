#!/usr/bin/env node

import path from 'path'
import fs from 'fs'
if (!fs.existsSync(path.resolve(process.cwd(), 'vars.yml'))) {
  throw new Error('expected vars.yml file')
}

import promisify from 'pify'
import _proc from 'child_process'
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

const command = `sls deploy --stage=${stage}`
let pathToNtfy
try {
  pathToNtfy = proc.execSync('command -v ntfy', {
    cwd: process.cwd(),
    stdio: 'inherit'
  })
} catch (err) {}

const stackName = yml.custom.prefix
const notify = (msg: string) => {
  if (pathToNtfy) {
    try {
      proc.execSync(`ntfy send "${msg}"`)
    } catch (err) {}
  }
}

;(async () => {
  console.log(command)
  proc.execSync(command, {
    cwd: process.cwd(),
    stdio: 'inherit'
  })

  notify(`deployed ${stackName}`)
})()
.catch(async (err) => {
  console.error(err)
  notify(`failed to deploy ${stackName}`)
  process.exitCode = 1
})
