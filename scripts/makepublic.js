#!/usr/bin/env node

process.env.IS_LAMBDA_ENVIRONMENT = false

const { makeDeploymentBucketPublic } = require('../lib/cli/utils')
makeDeploymentBucketPublic().catch(err => {
  console.error(err)
  process.exit(1)
})
