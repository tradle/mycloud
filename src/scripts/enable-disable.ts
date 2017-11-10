#!/usr/bin/env node

const co = require('co')
const { loadCredentials, genLocalResources } = require('../cli/utils')
const { lambdaUtils } = require('../')
const {
  enable
} = require('minimist')(process.argv.slice(2), {
  alias: {
    e: 'enable'
  },
  boolean: ['enable']
})

const {
  service,
  custom: { stage, prefix }
} = require('../cli/serverless-yml')

loadCredentials()

console.log('service', service)
console.log('stage', stage)
const action = enable ? 'enable' : 'disable'
console.log(`will ${action} all functions starting with prefix ${prefix}`)

co(function* () {
  yield lambdaUtils.updateEnvironments(function ({ FunctionName }) {
    if (FunctionName.startsWith(prefix)) {
      return {
        DISABLED: enable ? null : 'y'
      }
    }
  })
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
