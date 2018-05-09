#!/usr/bin/env node

import { createRemoteBot } from '../'

const yml = require('../cli/serverless-yml')
const {
  service,
  provider: { stage }
} = yml

const { aws } = createRemoteBot()
// const Bucket = 'io.tradle.dev.deploys'

const getEnv = async () => {
  const { Environment } = await aws.lambda.getFunctionConfiguration({
    FunctionName: `${service}-${stage}-onmessage`
  }).promise()

  process.stdout.write(JSON.stringify(Environment.Variables, null, 2))
}

getEnv().catch(console.error)
