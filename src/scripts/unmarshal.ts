#!/usr/bin/env node

import { unmarshallDBItem } from '../db-utils'
// import { unmarshalItem } from 'dynamodb-marshaler'

let str = ''
process.stdin
  .on('data', function (data) {
    str += data.toString()
  })
  .on('end', function () {
    const { Item, Items } = JSON.parse(str)
    const unmarshalled = Item ? unmarshallDBItem(Item) : Items.map(unmarshallDBItem)
    // const unmarshalled = Item ? unmarshalItem(Item) : Items.map(unmarshalItem)
    process.stdout.write(JSON.stringify(unmarshalled, null, 2))
  })
