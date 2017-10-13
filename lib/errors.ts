// const debug = require('debug')('tradle:sls:errors')
const ex = require('error-ex')

function createError (name: string): ErrorConstructor {
  return ex(name)
}

const errors = {
  NotFound: createError('NotFound'),
  InvalidSignature: createError('InvalidSignature'),
  InvalidMessageFormat: createError('InvalidMessageFormat'),
  PutFailed: createError('PutFailed'),
  MessageNotForMe: createError('MessageNotForMe'),
  HandshakeFailed: createError('HandshakeFailed'),
  LambdaInvalidInvocation: createError('LambdaInvalidInvocation'),
  InvalidInput: createError('InvalidInput'),
  ClockDrift: createError('ClockDrift'),
  BatchPutFailed: createError('BatchPutFailed'),
  Duplicate: createError('Duplicate'),
  TimeTravel: createError('TimeTravel'),
  ExecutionTimeout: createError('ExecutionTimeout'),
  export: (err:Error): {
    type:string,
    message:string
  } => {
    return {
      type: err.name.toLowerCase(),
      message: err.message
    }
  },
  isDeveloperError: (err:Error): boolean => {
    return err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError
  },
  isCustomError: (err:Error): boolean => {
    return err.name in errors
  },
  /**
   * check if error is of a certain type
   * @param  {Error}             err
   * @param  {String}  type
   * @return {Boolean}
   */
  is: (err:Error, errType:any): boolean => {
    const { name='' } = err
    return name.toLowerCase() === (errType || errType.type).toLowerCase()
  }
}

export = errors
