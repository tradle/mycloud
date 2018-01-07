#!/usr/bin/env node

import { unmarshalDBItem } from '../db-utils'

let str = ''
process.stdin
  .on('data', function (data) {
    str += data.toString()
  })
  .on('end', function () {
    const { Item, Items } = JSON.parse(str)
    const unmarshalled = Item ? unmarshalDBItem(Item) : Items.map(unmarshalDBItem)
    process.stdout.write(JSON.stringify(unmarshalled, null, 2))
  })
