#!/usr/bin/env node
const co = require('co').wrap
const Discovery = require('../project/lib/discovery')
// const Bucket = 'io.tradle.dev.deploys'
co(discover)().catch(console.error)

function* discover () {
  // console.log(yield s3.getBucketAcl({ Bucket }).promise())
  yield Discovery.discoverServices()
}
