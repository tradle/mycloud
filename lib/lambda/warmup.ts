process.env.LAMBDA_BIRTH_DATE = Date.now()

import AWS = require('aws-sdk')
import {
  WARMUP_SOURCE_NAME
} from '../constants'

const {
  SERVERLESS_PREFIX,
  SERVERLESS_ALIAS='$LATEST'
} = process.env

const lambda = new AWS.Lambda()
const commonParams = {
  InvocationType: 'RequestResponse',
  LogType: 'None',
  Qualifier: SERVERLESS_ALIAS,
  Payload: JSON.stringify({
    source: WARMUP_SOURCE_NAME
  })
}

export async function handler (event, context, callback) {
  const { functions } = event
  const defaultConcurrency = event.concurrency || 1
  let invokes = []
  let errors = 0
  console.log('Warm Up Start')
  await Promise.all(functions.map(async (warmUpConf) => {
    warmUpConf = normalizeWarmUpConf(warmUpConf)
    const { functionName, concurrency=defaultConcurrency } = warmUpConf
    const params = {
      ...commonParams,
      FunctionName: `${SERVERLESS_PREFIX}${functionName}`
    }

    console.log(`Attempting to warm up ${concurrency} instances of ${functionName}`)
    await Promise.all(new Array(concurrency).fill(0).map(async () => {
      try {
        const resp = await lambda.invoke(params).promise()
        console.log(`Warm Up Invoke Success: ${functionName}`, resp)
      } catch (err) {
        errors++
        console.log(`Warm Up Invoke Error: ${functionName}`, err.stack)
      }
    }))
  }))

  console.log(`Warm Up Finished with ${errors} invoke errors`)
  callback()
}

const normalizeWarmUpConf = warmUpConf => {
  if (typeof warmUpConf === 'string') {
    return { functionName: warmUpConf }
  }

  let functionName
  for (let p in warmUpConf) {
    functionName = p
    break
  }

  return {
    functionName,
    concurrency: warmUpConf[functionName].concurrency
  }
}
