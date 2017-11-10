#!/usr/bin/env node

const co = require('co')
const path = require('path')
const { getNativeModules, getProductionModules } = require('../cli/utils')

co(function* () {
  const [modules, prod] = yield Promise.all([
    getNativeModules(),
    getProductionModules()
  ])

  const prodOnly = modules.filter(name => {
    return prod.find(info => info.name === name)
  })

  process.stdout.write(prodOnly.join(' '))
})
.catch(err => {
  process.exitCode = 1
  console.error(err.stack)
})
