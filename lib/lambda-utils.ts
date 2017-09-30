const debug = require('debug')('tradls:sls:lambda-utils')
const co = require('co').wrap
const aws = require('./aws')

class Utils {
  constructor ({ env, aws }) {
    this.env = env
    this.aws = aws
  }

  getFullName = (name: string):boolean => {
    const { SERVERLESS_PREFIX='' } = this.env
    return name.startsWith(SERVERLESS_PREFIX)
      ? name
      : `${SERVERLESS_PREFIX}${name}`
  }

  invoke = async (opts: { name: string, arg?: any, sync?:boolean, log?: boolean }) => {
    const { name, arg={}, sync=true, log } = opts
    const FunctionName = getFullName(name)
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

  getConfiguration = (FunctionName:string):Promise<any> => {
    debug(`looking up configuration for ${FunctionName}`)
    return aws.lambda.getFunctionConfiguration({ FunctionName }).promise()
  }

  getStack = (StackName: string):Promise<any> => {
    return aws.cloudformation.listStackResources({ StackName }).promise()
  }

  listFunctions = ():Promise<any> => {
    return aws.lambda.listFunctions().promise()
  }

  updateEnvironment = async (opts: {
    functionName: string,
    current?: any,
    update: any
  }) => {
    let { functionName, current, update } = opts
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
    extend(Variables, updated)
    await this.aws.lambda.updateFunctionConfiguration({
      FunctionName: functionName,
      Environment: { Variables }
    }).promise()
  }

  get thisFunctionName () {
    return this.env.AWS_LAMBDA_FUNCTION_NAME
  }
}

export = Utils
