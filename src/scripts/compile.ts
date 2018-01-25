#!/usr/bin/env node

require('source-map-support').install()

import path = require('path')
import fs = require('fs')
import { compileTemplate, interpolateTemplate } from '../cli/utils'

const debug = require('debug')('tradle:sls:compile')
let {
  input,
  output
} = require('minimist')(process.argv.slice(2), {
  alias: {
    i: 'input',
    o: 'output'
  }
})

input = path.resolve(process.cwd(), input)
output = path.resolve(process.cwd(), output)
compileTemplate(input)
  .then(
    compiled => fs.writeFileSync(output, compiled),
    err => {
      console.error(err)
      process.exit(1)
    }
  )

// const fs = require('fs')
// const file = fs.readFileSync(process.argv[2] || 'serverless.yml', { encoding: 'utf8' })
// const lines = file.split('\n')

// function getResources (lines) {
//   const level0BlockRegex = /^[^ ]+/
//   const level2BlockRegex = /^[ ]{4}[^\s#]+/
//   const start = lines.findIndex(line => line === 'resources:')
//   const fromResources = lines.slice(start + 1)

//   const n = fromResources.findIndex(line => line.match(level0BlockRegex))
//   const end = n === -1 ? fromResources.length : n
//   return fromResources.slice(0, end)
//     .filter(line => line.match(level2BlockRegex))
// }

// function getEnvironmentLocation (lines) {
//   const providerIdx = lines.findIndex(line => line === 'provider:')
//   const environmentIdx = lines.slice(providerIdx).findIndex(line => line === '  environment:')
//   return environmentIdx
// }

// function getEnvironmentLines (lines) {

// }

// function addResources (lines) {
//   const idx = getEnvironmentLocation(lines)

// }

// console.log(getEnvironmentLocation(lines))
