import * as path from 'path'
import { promisify } from './utils'
import * as fs from 'fs'
import * as mkdirp from 'mkdirp'
import { Lambda } from 'aws-sdk'

const pfs = promisify(fs)
const pmkdirp = promisify(mkdirp)

export default class Discovery {
  private env: any
  private aws: any
  private lambdaUtils: any
  private iot: any
  private debug: (...any) => void
  public get thisFunctionName () {
    return this.lambdaUtils.thisFunctionName
  }

  constructor (opts: { env: any, aws: any, lambdaUtils: any, iot: any }) {
    const { env, aws, lambdaUtils, iot } = opts
    this.env = env
    this.debug = env.logger('discovery')
    this.aws = aws
    this.lambdaUtils = lambdaUtils
    this.iot = iot
  }

  public getServiceDiscoveryFunctionName = () => {
    return this.env.SERVERLESS_PREFIX + 'setenvvars'
  }

  public discoverServices = async (StackName?: string) => {
    const { thisFunctionName } = this
    let env
    if (thisFunctionName && thisFunctionName.endsWith('-setenvvars')) {
      env = await this.doDiscoverServices(StackName)
    } else {
      this.debug('delegating service discovery')
      env = await this.lambdaUtils.invoke({
        // hackity hack
        name: this.getServiceDiscoveryFunctionName(),
        sync: true
      })

      this.debug('received env', env)
    }

    return env
  }

  private doDiscoverServices = async (StackName?: string) => {
    const { thisFunctionName } = this
    this.debug(`performing service discovery in function ${thisFunctionName}`)
    const promiseIotEndpoint = this.iot.getEndpoint()
    let thisFunctionConfig
    if (!StackName) {
      thisFunctionConfig = await this.lambdaUtils.getConfiguration(thisFunctionName)

      StackName = thisFunctionConfig.Description
      if (!StackName.startsWith('arn:aws:cloudformation')) {
        throw new Error(`expected function ${thisFunctionName} Description to contain Ref: StackId`)
      }
    }

    const resources = await this.lambdaUtils.getStackResources(StackName)
    const env = {
      IOT_ENDPOINT: await promiseIotEndpoint
    }

    // const env = extend({
    //   IOT_ENDPOINT: await promiseIotEndpoint
    // }, Resources.environmentForStack({ StackResourceSummaries }))

    const willWrite = resources.every(({ ResourceStatus }) => {
      return ResourceStatus === 'CREATE_COMPLETE' ||
        ResourceStatus === 'UPDATE_COMPLETE'
    })

    if (willWrite) {
      this.debug('setting environment variables for lambdas', JSON.stringify(env, null, 2))

      // theoretically, this could run
      // while the function does its actual work
      const functions = resources.filter(isLambda)
      this.debug('will update functions', JSON.stringify(functions, null, 2))
      await Promise.all(functions.map(({ PhysicalResourceId }) => {
        let current
        if (PhysicalResourceId === thisFunctionName) {
          current = thisFunctionConfig
        }

        this.debug(`updating environment variables for: ${PhysicalResourceId}`)
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
      this.debug('failed to write environment')
    }
  }
}

// function getFunctionNameFromArn (arn) {
//   return arn.slice(arn.lastIndexOf('/') + 1)
// }

function isLambda (summary) {
  return summary.ResourceType === 'AWS::Lambda::Function'
}
