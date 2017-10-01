#!/usr/bin/env node

const co = require('co')
const { loadCredentials, genLocalResources } = require('../lib/cli/utils')
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
} = require('../lib/cli/serverless-yml')

loadCredentials()

console.log('service', service)
console.log('stage', stage)
const action = enable ? 'enable' : 'disable'
console.log(`will ${action} all functions starting with prefix ${prefix}`)

co(function* () {
  const { Functions } = yield lambdaUtils.listFunctions()
  const toChange = Functions
    .filter(({ FunctionName }) => FunctionName.startsWith(prefix))

  yield toChange.slice(0, 1).map(function (current) {
    const { FunctionName } = current
    console.log(action, FunctionName)
    return lambdaUtils.updateEnvironment({
      functionName: FunctionName,
      current,
      update: {
        DISABLED: enable ? null : 'y'
      }
    })
  })
})
.catch(err => {
  console.error(err)
  process.exit(1)
})
