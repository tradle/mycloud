// import path from 'path'
// import fs from 'fs'
// import mkdirp from 'mkdirp'
import { Logger, Env, LambdaUtils, StackUtils, Iot } from './types'

// const pfs = promisify(fs)
// const pmkdirp = promisify(mkdirp)

export default class Discovery {
  private env: Env
  private aws: any
  private lambdaUtils: LambdaUtils
  private stackUtils: StackUtils
  private iot: Iot
  private logger: Logger
  public get thisFunctionName () {
    return this.lambdaUtils.thisFunctionName
  }

  constructor (opts: {
    env: Env,
    aws: any,
    lambdaUtils: LambdaUtils,
    stackUtils: StackUtils,
    iot: Iot,
    logger: Logger
  }) {
    const { env, aws, lambdaUtils, iot, logger } = opts
    this.env = env
    this.logger = logger.sub('discovery')
    this.aws = aws
    this.lambdaUtils = lambdaUtils
    this.iot = iot
  }

  public getServiceDiscoveryFunctionName = () => {
    return this.env.STACK_RESOURCE_PREFIX + 'setenvvars'
  }

  public discoverServices = async (StackName?: string) => {
    const { thisFunctionName } = this
    let env
    if (thisFunctionName && thisFunctionName.endsWith('-setenvvars')) {
      env = await this.doDiscoverServices(StackName)
    } else {
      this.logger.info('delegating service discovery')
      env = await this.lambdaUtils.invoke({
        // hackity hack
        name: this.getServiceDiscoveryFunctionName(),
        sync: true
      })

      this.logger.debug('received env', env)
    }

    return env
  }

  /**
   * updates IOT_ENDPOINT env var on all lambdas
   *
   * NOT USED ANYMORE
   */
  private doDiscoverServices = async (StackName?: string) => {
    const { thisFunctionName } = this
    this.logger.debug(`performing service discovery in function ${thisFunctionName}`)
    const promiseIotEndpoint = this.iot.getEndpoint()
    let thisFunctionConfig
    if (!StackName) {
      thisFunctionConfig = await this.lambdaUtils.getConfiguration(thisFunctionName)

      StackName = thisFunctionConfig.Description
      if (!StackName.startsWith('arn:aws:cloudformation')) {
        throw new Error(`expected function ${thisFunctionName} Description to contain Ref: StackId`)
      }
    }

    const resources = await this.stackUtils.getStackResources(StackName)
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
      this.logger.debug('setting environment variables for lambdas', JSON.stringify(env, null, 2))

      // theoretically, this could run
      // while the function does its actual work
      const functions = resources.filter(isLambda)
      this.logger.debug('will update functions', JSON.stringify(functions, null, 2))
      await Promise.all(functions.map(async ({ PhysicalResourceId }) => {
        let current
        if (PhysicalResourceId === thisFunctionName) {
          current = thisFunctionConfig
        }

        this.logger.debug(`updating environment variables for: ${PhysicalResourceId}`)
        return this.stackUtils.updateEnvironment({
          functionName: PhysicalResourceId,
          update: env,
          current
        })
      }))

      // if (process.env.IS_LOCAL) {
      //   await this.saveToLocalFS(env)
      // }
    }

    return env
  }

  // private saveToLocalFS = async (vars) => {
  //   const { RESOURCES_ENV_PATH } = this.env
  //   try {
  //     await pmkdirp(path.dirname(RESOURCES_ENV_PATH))
  //     await pfs.writeFile(RESOURCES_ENV_PATH, JSON.stringify(vars, null, 2))
  //   } catch (err) {
  //     this.logger.error('failed to write environment', { error: err.stack })
  //   }
  // }
}

export { Discovery }

// function getFunctionNameFromArn (arn) {
//   return arn.slice(arn.lastIndexOf('/') + 1)
// }

function isLambda (summary) {
  return summary.ResourceType === 'AWS::Lambda::Function'
}
