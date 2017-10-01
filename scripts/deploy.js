#!/usr/bin/env node

const proc = require('child_process')
const yml = require('../lib/cli/serverless-yml')
const stage = process.argv[2] || yml.custom.stage
if (!/^[a-zA-Z-_]+$/.test(stage)) {
  throw new Error('invalid stage: ' + stage)
}

// some bug, otherwise you could just run sls deploy
// https://forum.serverless.com/t/feature-branching-and-aws-apigateway-name/1890
const command = `sls deploy --stage=${stage}`

console.log('will run:', command)

proc.execSync('npm run build:yml', {
  cwd: process.cwd(),
  stdio: 'inherit'
})

proc.execSync(command, {
  cwd: process.cwd(),
  stdio: 'inherit'
})
