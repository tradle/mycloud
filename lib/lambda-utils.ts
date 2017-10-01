const debug = require('debug')('tradls:sls:lambda-utils')
import { extend } from './utils'

class Utils {
  private env: any
  private aws: any
  public get thisFunctionName () {
    return this.env.AWS_LAMBDA_FUNCTION_NAME
  }

  constructor ({ env, aws }) {
    this.env = env
    this.aws = aws
  }

  public getFullName = (name: string):boolean => {
    const { SERVERLESS_PREFIX='' } = this.env
    return name.startsWith(SERVERLESS_PREFIX)
      ? name
      : `${SERVERLESS_PREFIX}${name}`
  }

  public invoke = async (opts: { name: string, arg?: any, sync?:boolean, log?: boolean }) => {
    const { name, arg={}, sync=true, log } = opts
    const FunctionName = this.getFullName(name)
    const params = {
      InvocationType: sync ? 'RequestResponse' : 'Event',
      FunctionName,
      Payload: typeof arg === 'string' ? arg : JSON.stringify(arg)
    }

    if (log) params.LogType = 'Tail'

    const {
      StatusCode,
      Payload,
      FunctionError
    } = await aws.lambda.invoke(params).promise()

    if (StatusCode >= 300) {
      const message = Payload || `experienced ${FunctionError} error invoking lambda: ${name}`
      throw new Error(message)
    }

    if (sync) return JSON.parse(Payload)
  }

  public getConfiguration = (FunctionName:string):Promise<any> => {
    debug(`looking up configuration for ${FunctionName}`)
    return aws.lambda.getFunctionConfiguration({ FunctionName }).promise()
  }

  public getStack = (StackName: string):Promise<any> => {
    return aws.cloudformation.listStackResources({ StackName }).promise()
  }

  public listFunctions = ():Promise<any> => {
    return aws.lambda.listFunctions().promise()
  }

  public updateEnvironment = async (opts: {
    functionName: string,
    current?: any,
    update: any
  }) => {
    const { functionName, update } = opts
    let { current } = opts
    if (!current) {
      current = await this.getConfiguration(functionName)
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
    for (let key in updated) {
      let val = updated[key]
      if (val == null) {
        delete Variables[key]
      } else {
        Variables[key] = val
      }
    }

    await this.aws.lambda.updateFunctionConfiguration({
      FunctionName: functionName,
      Environment: { Variables }
    }).promise()
  }
}

export = Utils
