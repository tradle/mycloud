#!/usr/bin/env node

const YAML = require('js-yaml')

let str = ''
process.stdin
  .on('data', data => str += data.toString())
  .on('end', () => process.stdout.write(JSON.stringify(YAML.load(str), null, 2)))
  .on('error', err => {
    process.stderr.write(err.stack)
    process.exitCode = 1
  })
