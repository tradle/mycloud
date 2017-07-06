const debug = require('debug')('tradle:sls:discovery')
const path = require('path')
const promisify = require('pify')
const fs = promisify(require('fs'))
const mkdirp = promisify(require('mkdirp'))
const co = require('co').wrap
const extend = require('xtend/mutable')
const Resources = require('./resources')
const aws = require('./aws')
const { invoke, getStack, getConfiguration } = require('./lambda-utils')
const Iot = require('./iot-utils')
const ENV = require('./env')

const updateEnvironment = co(function* ({ functionName, current, update }) {
  if (!current) {
    current = yield getConfiguration(functionName)
  }

  const updated = {}
  const { Variables } = current.Environment
  for (let key in update) {
    if (Variables[key] !== update[key]) {
      updated[key] = update[key]
    }
  }

  if (!Object.keys(updated).length) {
    debug(`not updating "${functionName}", no new environment variables`)
    return
  }

  debug(`updating "${functionName}" with new environment variables`)
  extend(Variables, updated)
  yield aws.lambda.updateFunctionConfiguration({
    FunctionName: functionName,
    Environment: { Variables }
  }).promise()
})

function getServiceDiscoveryFunctionName () {
  // function naming is ${service}-${stage}-${name}
  const thisFunctionName = getThisFunctionName()
  if (thisFunctionName) {
    const parts = thisFunctionName.split('-')
    parts[parts.length - 1] = 'setenvvars'
    return parts.join('-')
  }

  const {
    SERVERLESS_STAGE,
    SERVERLESS_SERVICE_NAME
  } = require('./env')

  return `${SERVERLESS_SERVICE_NAME}-${SERVERLESS_STAGE}-setenvvars`
}

const discoverServices = co(function* (StackName) {
  const thisFunctionName = getThisFunctionName()
  let env
  if (thisFunctionName && thisFunctionName.endsWith('-setenvvars')) {
    env = yield doDiscoverServices(StackName)
  } else {
    debug('delegating service discovery')
    env = yield invoke({
      // hackity hack
      name: getServiceDiscoveryFunctionName(),
      sync: true
    })

    debug('received env', env)
  }

  ENV.set(env)
  // Resources.set(env)
  return env
})

const doDiscoverServices = co(function* (StackName) {
  debug('performing service discovery')
  const thisFunctionName = getThisFunctionName()
  const promiseIotEndpoint = Iot.getEndpoint()
  let thisFunctionConfig
  if (!StackName) {
    thisFunctionConfig = yield getConfiguration(thisFunctionName)
    StackName = thisFunctionConfig.Description
    if (!StackName.startsWith('arn:aws:cloudformation')) {
      throw new Error(`expected function ${thisFunctionName} Description to contain Ref: StackId`)
    }
  }

  const { StackResourceSummaries } = yield getStack(StackName)
  const env = {
    IOT_ENDPOINT: yield promiseIotEndpoint
  }

  // const env = extend({
  //   IOT_ENDPOINT: yield promiseIotEndpoint
  // }, Resources.environmentForStack({ StackResourceSummaries }))

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
        current = thisFunctionConfig
      }

      debug(`updating environment variables for: ${PhysicalResourceId}`)
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
  const { RESOURCES_ENV_PATH } = ENV
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
