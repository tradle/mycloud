#!/usr/bin/env node
// require('..//test/env')

const co = require('co')
const Discovery = require('..//lib/discovery')
// const Bucket = 'io.tradle.dev.deploys'
co(discover)
  .then(env => {
    process.stdout.write(JSON.stringify(env, null, 2))
  })
  .catch(console.error)

function* discover () {
  // console.log(yield s3.getBucketAcl({ Bucket }).promise())
  return yield Discovery.discoverServices({
    functionName: 'tradle-dev-setenvvars'
  })
}
