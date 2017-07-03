const debug = require('debug')('tradle:sls:discovery')
const path = require('path')
const promisify = require('pify')
const fs = promisify(require('fs'))
const mkdirp = promisify(require('mkdirp'))
const co = require('co').wrap
const extend = require('xtend/mutable')
const Resources = require('./resources')
const aws = require('./aws')
const Iot = require('./iot-utils')
const {
  RESOURCES_ENV_PATH
} = require('./env')

const updateEnvironment = co(function* ({ functionName, current, update }) {
  if (!current) {
    current = yield aws.lambda.getFunctionConfiguration({
      FunctionName: functionName
    }).promise()
  }

  const updated = {}
  const { Variables } = current.Environment
  for (let key in update) {
    if (key in Variables) {
    //   debug(`refusing to override environment variable: ${key}`)
    // } else {
      updated[key] = update[key]
    }
  }

  if (Object.keys(updated)) {
    extend(Variables, updated)
    yield aws.lambda.updateFunctionConfiguration({
      FunctionName: functionName,
      Environment: { Variables }
    }).promise()
  }
})

function getServiceDiscoveryFunctionName () {
  // function naming is ${service}-${stage}-${name}
  const thisFunctionName = getThisFunctionName()
  const parts = thisFunctionName.split('-')
  parts[parts.length - 1] = 'setenvvars'
  return parts.join('-')
}

const discoverServices = co(function* () {
  const thisFunctionName = getThisFunctionName()
  let env
  if (thisFunctionName.endsWith('-setenvvars')) {
    env = yield doDiscoverServices()
  } else {
    debug('delegating service discovery')
    const result = yield aws.lambda.invoke({
      // hackity hack
      FunctionName: getServiceDiscoveryFunctionName(),
      InvocationType: 'RequestResponse',
      Payload: '{}'
    }).promise()

    env = JSON.parse(result.Payload)
    debug('received env', JSON.stringify(env))
  }

  extend(process.env, env)
  Resources.set(env)
  return env
})

const doDiscoverServices = co(function* () {
  debug('performing service discovery')
  const thisFunctionName = getThisFunctionName()
  const promiseIotEndpoint = Iot.getEndpoint()
  const myConfig = yield aws.lambda.getFunctionConfiguration({
    FunctionName: thisFunctionName
  }).promise()

  const { StackResourceSummaries } = yield aws.cloudformation.listStackResources({
    StackName: myConfig.Description
  }).promise()

  const env = {
    IOT_ENDPOINT: yield promiseIotEndpoint
  }

  StackResourceSummaries
    .filter(({ ResourceType }) => Resources.isMappedType(ResourceType))
    .forEach(summary => {
      const { key, value } = Resources.toEnvironmentMapping(summary)
      env[key] = value
    })

  const willWrite = StackResourceSummaries.every(({ ResourceStatus }) => {
    return ResourceStatus === 'CREATE_COMPLETE' ||
      ResourceStatus === 'UPDATE_COMPLETE'
  })

  if (willWrite) {
    debug('setting environment variables for lambdas')

    // theoretically, this could run
    // while the function does its actual work
    const functions = StackResourceSummaries.filter(isLambda)
    yield Promise.all(functions.map(({ PhysicalResourceId }) => {
      let current
      if (PhysicalResourceId === thisFunctionName) {
        current = myConfig
      }

      return updateEnvironment({
        functionName: PhysicalResourceId,
        update: env,
        current
      })
    }))

    if (process.env.IS_LOCAL) {
      yield saveToLocalFS(env)
    }
  }

  return env
})

function getThisFunctionName () {
  return process.env.AWS_LAMBDA_FUNCTION_NAME
}

const saveToLocalFS = co(function* (vars) {
  try {
    yield mkdirp(path.dirname(RESOURCES_ENV_PATH))
    yield fs.writeFile(RESOURCES_ENV_PATH, JSON.stringify(vars, null, 2))
  } catch (err) {
    debug('failed to write environment')
  }
})

function getFunctionNameFromArn (arn) {
  return arn.slice(arn.lastIndexOf('/') + 1)
}

function isLambda (summary) {
  return summary.ResourceType === 'AWS::Lambda::Function'
}

module.exports = {
  discoverServices,
  updateEnvironment
}
