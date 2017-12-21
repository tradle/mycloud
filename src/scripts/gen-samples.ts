#!/usr/bin/env node

import { pick } from 'lodash'
import request = require('superagent')

const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    u: 'users',
    p: 'products',
    l: 'local'
  },
  default: {
    users: 1,
    products: ['tradle.CurrentAccount']
  }
})

if (argv.local) {
  process.exit(0)
}

const {
  SERVERLESS_STAGE,
  SERVERLESS_SERVICE_NAME,
  R_RESTAPI_ApiGateway
} = require('../test/service-map')

const genSamplesUrl = `https://${R_RESTAPI_ApiGateway}.execute-api.us-east-1.amazonaws.com/${SERVERLESS_STAGE}/${SERVERLESS_SERVICE_NAME}/samples`

;(async () => {
  const res = await request
    .post(genSamplesUrl)
    .set('Accept', 'application/json')
    .send(pick(argv, ['users', 'products']))

  const { ok, body } = res
  const text = JSON.stringify(body, null, 2)
  if (!ok) {
    throw new Error(text)
  }

  if (text) {
    console.log(text)
  }
})()
.catch(err => {
  console.error(err)
  process.exit(1)
})
