#!/usr/bin/env node

import { createRemoteTradle } from '../'

const { aws } = createRemoteTradle()
// const Bucket = 'io.tradle.dev.deploys'

const getEnv = async () => {
  const { Environment } = await aws.lambda.getFunctionConfiguration({
    FunctionName: 'tradle-dev-onmessage'
  }).promise()

  process.stdout.write(JSON.stringify(Environment.Variables, null, 2))
}

getEnv().catch(console.error)
