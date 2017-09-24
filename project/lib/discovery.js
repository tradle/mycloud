const debug = require('debug')('tradle:sls:discovery')
const path = require('path')
const { co, extend, bindAll, promisify } = require('./utils')
const fs = promisify(require('fs'))
const mkdirp = promisify(require('mkdirp'))

module.exports = Discovery

function Discovery ({ env, aws, lambdaUtils, iot }) {
  bindAll(this)

  this.env = env
  this.aws = aws
  this.lambdaUtils = lambdaUtils
  this.iot = iot
}

const proto = Discovery.prototype

proto.updateEnvironment = co(function* ({ functionName, current, update }) {
  if (!current) {
    current = yield this.lambdaUtils.getConfiguration(functionName)
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
  yield this.aws.lambda.updateFunctionConfiguration({
    FunctionName: functionName,
    Environment: { Variables }
  }).promise()
})

proto.getServiceDiscoveryFunctionName = function getServiceDiscoveryFunctionName () {
  // function naming is ${service}-${stage}-${name}
  const thisFunctionName = this.getThisFunctionName()
  if (thisFunctionName) {
    const parts = thisFunctionName.split('-')
    parts[parts.length - 1] = 'setenvvars'
    return parts.join('-')
  }

  const {
    SERVERLESS_STAGE,
    SERVERLESS_SERVICE_NAME
  } = this.env

  return `${SERVERLESS_SERVICE_NAME}-${SERVERLESS_STAGE}-setenvvars`
}

proto.discoverServices = co(function* (StackName) {
  const thisFunctionName = this.getThisFunctionName()
  let env
  if (thisFunctionName && thisFunctionName.endsWith('-setenvvars')) {
    env = yield this.doDiscoverServices(StackName)
  } else {
    debug('delegating service discovery')
    env = yield this.lambdaUtils.invoke({
      // hackity hack
      name: this.getServiceDiscoveryFunctionName(),
      sync: true
    })

    debug('received env', env)
  }

  return env
})

proto.doDiscoverServices = co(function* (StackName) {
  debug('performing service discovery')
  const thisFunctionName = this.getThisFunctionName()
  const promiseIotEndpoint = this.iot.getEndpoint()
  let thisFunctionConfig
  if (!StackName) {
    thisFunctionConfig = yield this.lambdaUtils.getConfiguration(thisFunctionName)
    StackName = thisFunctionConfig.Description
    if (!StackName.startsWith('arn:aws:cloudformation')) {
      throw new Error(`expected function ${thisFunctionName} Description to contain Ref: StackId`)
    }
  }

  const { StackResourceSummaries } = yield this.lambdaUtils.getStack(StackName)
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
      return this.updateEnvironment({
        functionName: PhysicalResourceId,
        update: env,
        current
      })
    }))

    if (process.env.IS_LOCAL) {
      yield this.saveToLocalFS(env)
    }
  }

  return env
})

proto.getThisFunctionName = function getThisFunctionName () {
  return this.env.AWS_LAMBDA_FUNCTION_NAME
}

proto.saveToLocalFS = co(function* (vars) {
  const { RESOURCES_ENV_PATH } = this.env
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
