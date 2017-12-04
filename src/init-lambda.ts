import { Module } from 'module'

const { _load } = Module

Module._load = function (name, parent) {
  if (require.track) {
    console.log('REQUIRING AT LAMBDA EXECUTION TIME (not recommended)', name)
  }

  return _load.apply(this, arguments)
}

// require("time-require")
process.env.LAMBDA_BIRTH_DATE = Date.now()
require('source-map-support').install()
import './globals'

import { tradle } from './'

const { env, lambdaUtils } = tradle
if (env.INVOKE_BOT_LAMBDAS_DIRECTLY) {
  if (env.FUNCTION_NAME === 'onmessage' ||
    env.FUNCTION_NAME === 'onmessage_http' ||
    env.FUNCTION_NAME === 'inbox') {
    lambdaUtils.requireLambdaByName(env.BOT_ONMESSAGE)
  }
}
