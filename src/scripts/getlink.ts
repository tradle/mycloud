#!/usr/bin/env node

// get the 'link' of an object

import { utils } from '@tradle/engine'

let str = ''
process.stdin
  .on('data', data => {
    str += data.toString()
  })
  .on('error', err => {
    throw err
  })
  .on('end', function () {
    process.stdout.write(utils.hexLink(JSON.parse(str)))
  })
