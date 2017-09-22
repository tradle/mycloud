#!/usr/bin/env node

const fs = require('fs')
const YAML = require('js-yaml')
const debug = require('debug')('tradle:sls:compile')
const file = fs.readFileSync(process.argv[2], { encoding: 'utf8' })
const yaml = YAML.load(file)
const isLocal = process.env.IS_LOCAL
const {
  addResourcesToEnvironment,
  addResourcesToOutputs,
  removeResourcesThatDontWorkLocally,
} = require('../lib/cli/compile')

if (isLocal) {
  removeResourcesThatDontWorkLocally(yaml)
}

addResourcesToEnvironment(yaml)
addResourcesToOutputs(yaml)
process.stdout.write(YAML.dump(yaml))

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
