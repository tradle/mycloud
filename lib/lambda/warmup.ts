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
  let invokes = []
  let errors = 0
  console.log('Warm Up Start')
  await Promise.all(functions.map(async (functionName) => {
    const params = {
      ...commonParams,
      FunctionName: `${SERVERLESS_PREFIX}${functionName}`
    }

    try {
      const resp = await lambda.invoke(params).promise()
      console.log(`Warm Up Invoke Success: ${functionName}`, resp)
    } catch (err) {
      errors++
      console.log(`Warm Up Invoke Error: ${functionName}`, err.stack)
    }
  }))

  console.log(`Warm Up Finished with ${errors} invoke errors`)
  callback()
}
