#!/usr/bin/env node

import path from 'path'
import { getNativeModules } from '../cli/utils'
import { uniqueStrict } from '../utils'

const modules = []
const promiseNative = getNativeModules()

process.stdin
  .on('data', paths => {
    paths.toString().split('\n').forEach(filePath => {
      modules.push(filePath.split('node_modules/').pop())
    })
  })
  .on('end', async () => {
    const native = await promiseNative
    const prodNative = uniqueStrict(modules).filter(name => {
      return native.find(str => str === name)
    })

    process.stdout.write(prodNative.join(' '))
  })

process.on('unhandledRejection', err => {
  process.exitCode = 1
  console.error(err.stack)
})
