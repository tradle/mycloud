import * as path from 'path'
import { extend, bindAll, promisify } from './utils'
import * as fs from 'fs'
import * as mkdirp from 'mkdirp'

const debug = require('debug')('tradle:sls:discovery')
const pfs = promisify(fs)
const pmkdirp = promisify(mkdirp)

class Discovery {
  private env: any
  private aws: any
  private lambdaUtils: any
  private iot: any
  public get thisFunctionName () {
    return this.lambdaUtils.thisFunctionName
  }

  constructor (opts: { env: any, aws: any, lambdaUtils: any, iot: any }) {
    const { env, aws, lambdaUtils, iot } = opts
    this.env = env
    this.aws = aws
    this.lambdaUtils = lambdaUtils
    this.iot = iot
  }

  public getServiceDiscoveryFunctionName = () => {
    // function naming is ${service}-${stage}-${name}
    const { thisFunctionName } = this
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

  public discoverServices = async (StackName?: string) => {
    const { thisFunctionName } = this
    let env
    if (thisFunctionName && thisFunctionName.endsWith('-setenvvars')) {
      env = await this.doDiscoverServices(StackName)
    } else {
      debug('delegating service discovery')
      env = await this.lambdaUtils.invoke({
        // hackity hack
        name: this.getServiceDiscoveryFunctionName(),
        sync: true
      })

      debug('received env', env)
    }

    return env
  }

  private doDiscoverServices = async (StackName?: string) => {
    debug('performing service discovery')
    const { thisFunctionName } = this
    const promiseIotEndpoint = this.iot.getEndpoint()
    let thisFunctionConfig
    if (!StackName) {
      thisFunctionConfig = await this.lambdaUtils.getConfiguration(thisFunctionName)
      StackName = thisFunctionConfig.Description
      if (!StackName.startsWith('arn:aws:cloudformation')) {
        throw new Error(`expected function ${thisFunctionName} Description to contain Ref: StackId`)
      }
    }

    const { StackResourceSummaries } = await this.lambdaUtils.getStack(StackName)
    const env = {
      IOT_ENDPOINT: await promiseIotEndpoint
    }

    // const env = extend({
    //   IOT_ENDPOINT: await promiseIotEndpoint
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
      await Promise.all(functions.map(({ PhysicalResourceId }) => {
        let current
        if (PhysicalResourceId === thisFunctionName) {
          current = thisFunctionConfig
        }

        debug(`updating environment variables for: ${PhysicalResourceId}`)
        return this.lambdaUtils.updateEnvironment({
          functionName: PhysicalResourceId,
          update: env,
          current
        })
      }))

      if (process.env.IS_LOCAL) {
        await this.saveToLocalFS(env)
      }
    }

    return env
  }

  private saveToLocalFS = async (vars) => {
    const { RESOURCES_ENV_PATH } = this.env
    try {
      await pmkdirp(path.dirname(RESOURCES_ENV_PATH))
      await pfs.writeFile(RESOURCES_ENV_PATH, JSON.stringify(vars, null, 2))
    } catch (err) {
      debug('failed to write environment')
    }
  }
}

function getFunctionNameFromArn (arn) {
  return arn.slice(arn.lastIndexOf('/') + 1)
}

function isLambda (summary) {
  return summary.ResourceType === 'AWS::Lambda::Function'
}

export = Discovery

