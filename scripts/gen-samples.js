#!/usr/bin/env node

const co = require('co')
const pick = require('object.pick')
const request = require('superagent')
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

const projectRequire = require('./require')
if (argv.local) {
  // projectRequire('./test/env')
  process.exit(0)
}

const {
  SERVERLESS_STAGE,
  SERVERLESS_SERVICE_NAME,
  R_RESTAPI_ApiGateway
} = projectRequire('./conf/service-map')

const genSamplesUrl = `https://${R_RESTAPI_ApiGateway}.execute-api.us-east-1.amazonaws.com/${SERVERLESS_STAGE}/${SERVERLESS_SERVICE_NAME}/samples`

co(function* () {
  const res = yield request
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
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
