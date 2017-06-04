#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const envPath = path.join(process.cwd(), 'env.json')
let env
try {
  env = require(envPath)
} catch (err) {
  env = {}
}

env.ACCOUNT_ID = execSync('aws sts get-caller-identity --output text --query Account').toString().trim()

fs.writeFileSync(envPath, JSON.stringify(env, null, 2), { encoding: 'utf8' })
