const debug = require('debug')('tradls:sls:lambda-utils')
import { Lambda } from 'aws-sdk'

const notNull = (val:any):boolean => !!val

export default class Utils {
  private env: any
  private aws: any
  public get thisFunctionName () {
    return this.env.AWS_LAMBDA_FUNCTION_NAME
  }

  constructor ({ env, aws }) {
    this.env = env
    this.aws = aws
  }

  public getFullName = (name: string):string => {
    const { SERVERLESS_PREFIX='' } = this.env
    return name.startsWith(SERVERLESS_PREFIX)
      ? name
      : `${SERVERLESS_PREFIX}${name}`
  }

  public invoke = async (opts: {
    name: string,
    arg?: any,
    sync?:boolean,
    log?: boolean
  }):Promise<any> => {
    const { name, arg={}, sync=true, log } = opts
    const FunctionName = this.getFullName(name)
    const params:Lambda.Types.InvocationRequest = {
      InvocationType: sync ? 'RequestResponse' : 'Event',
      FunctionName,
      Payload: typeof arg === 'string' ? arg : JSON.stringify(arg)
    }

    if (log) params.LogType = 'Tail'

    const {
      StatusCode,
      Payload,
      FunctionError
    } = await this.aws.lambda.invoke(params).promise()

    if (StatusCode >= 300) {
      const message = Payload || `experienced ${FunctionError} error invoking lambda: ${name}`
      throw new Error(message)
    }

    if (sync) return JSON.parse(Payload)
  }

  public getConfiguration = (FunctionName:string):Promise<Lambda.Types.FunctionConfiguration> => {
    debug(`looking up configuration for ${FunctionName}`)
    return this.aws.lambda.getFunctionConfiguration({ FunctionName }).promise()
  }

  public getStack = (StackName: string):Promise<any> => {
    return this.aws.cloudformation.listStackResources({ StackName }).promise()
  }

  public listFunctions = ():Promise<Lambda.Types.ListFunctionsResponse> => {
    return this.aws.lambda.listFunctions().promise()
  }

  public updateEnvironments = async(map:(conf:Lambda.Types.FunctionConfiguration) => any) => {
    const { Functions } = await this.listFunctions()
    if (!Functions) return

    const writes = Functions.map(current => {
      const update = map(current)
      return update && {
        current,
        update
      }
    })
    .filter(notNull)
    .map(this.updateEnvironment)

    await Promise.all(writes)
  }

  public updateEnvironment = async (opts: {
    functionName?: string,
    current?: any,
    update: any
  }) => {
    let { functionName, update } = opts
    let { current } = opts
    if (!current) {
      if (!functionName) throw new Error('expected "functionName"')

      current = await this.getConfiguration(functionName)
    }

    functionName = current.FunctionName
    const updated = {}
    const { Variables } = current.Environment
    for (let key in update) {
      // allow null == undefined
      if (Variables[key] != update[key]) {
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
