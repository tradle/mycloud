#!/usr/bin/env node

import path = require('path')
import { getNativeModules, getProductionModules } from '../cli/utils'

(async () => {
  const [modules, prod] = await Promise.all([
    getNativeModules(),
    getProductionModules()
  ])

  const prodOnly = modules.filter(name => {
    return prod.find(info => info.name === name)
  })

  process.stdout.write(prodOnly.join(' '))
})()
.catch(err => {
  process.exitCode = 1
  console.error(err.stack)
})
