#!/usr/bin/env node

const { makeDeploymentBucketPublic } = require('../lib/cli/utils')
makeDeploymentBucketPublic().catch(err => {
  console.error(err)
  process.exit(1)
})
