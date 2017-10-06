#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
if (!fs.existsSync(path.resolve(process.cwd(), 'vars.yml'))) {
  throw new Error('expected vars.yml file')
}


const proc = require('child_process')
const omit = require('object.omit')

// some bug, otherwise you could just run sls deploy
// https://forum.serverless.com/t/feature-branching-and-aws-apigateway-name/1890

proc.execSync('npm run build:yml', {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: omit(process.env, ['SLS_DEBUG', 'DEBUG'])
})

const yml = require('../lib/cli/serverless-yml')
const stage = process.argv[2] || yml.custom.stage
if (!/^[a-zA-Z-_]+$/.test(stage)) {
  throw new Error('invalid stage: ' + stage)
}

const command = `sls deploy --stage=${stage}`
console.log('will run:', command)

proc.execSync(command, {
  cwd: process.cwd(),
  stdio: 'inherit'
})
