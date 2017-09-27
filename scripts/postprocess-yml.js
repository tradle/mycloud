#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const YAML = require('js-yaml')
const uncompiledPath = path.join(__dirname, '../serverless-uncompiled.yml')
const uncompiled = YAML.load(fs.readFileSync(uncompiledPath))
let yml = ''
process.stdin
  .on('data', data => {
    yml += data.toString()
  })
  .on('error', err => {
    console.error(err)
    process.exit(1)
  })
  .on('end', () => {
    yml = YAML.load(yml.trim())
    yml.provider.variableSyntax = uncompiled.provider.variableSyntax
    // yml = yml.replace(/\$(\{AWS::[^}]+\})/g, '${$1}')
    process.stdout.write(YAML.dump(yml))
  })
