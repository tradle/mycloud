#!/usr/bin/env node

const { unmarshalDBItem } = require('../db-utils')

let str = ''
process.stdin
  .on('data', function (data) {
    str += data.toString()
  })
  .on('end', function () {
    const { Items } = JSON.parse(str)
    const unmarshalled = Items.map(unmarshalDBItem)
    process.stdout.write(JSON.stringify(unmarshalled, null, 2))
  })
