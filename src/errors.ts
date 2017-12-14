// const debug = require('debug')('tradle:sls:errors')
import pick = require('object.pick')
import deepEqual = require('deep-equal')
import ex = require('error-ex')
import { AssertionError } from 'assert'
import { TfTypeError, TfPropertyTypeError } from 'typeforce'

function createError (name: string): ErrorConstructor {
  return ex(name)
}

const types = {
  system: [
    // JavaScript
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,

    // Node
    AssertionError,

    // Typeforce
    TfTypeError,
    TfPropertyTypeError
  ]
}

const isSystemError = err => types.system.some(ErrorCtor => {
  return err instanceof ErrorCtor
})

const matches = (err, type) => {
  if (!(err && type)) {
    throw new Error('expected error and match parameters')
  }

  if (type === 'system') {
    return isSystemError(err)
  }
  if (typeof type === 'function' &&
    (err instanceof type || errors.is(err, type))) {
    return true
  }

  for (let key in type) {
    let expected = type[key]
    let actual = err[key]
    if (expected instanceof RegExp) {
      if (!expected.test(actual)) {
        return false
      }
    } else if (!deepEqual(expected, actual)) {
      return false
    }
  }

  return true
}

const ignore = (err, type) => {
  if (!matches(err, type)) {
    throw err
  }
}

const rethrow = (err, type) => {
  if (matches(err, type)) {
    throw err
  }
}

const HttpError = createError('HttpError')
const errors = {
  ClientUnreachable: createError('ClientUnreachable'),
  NotFound: createError('NotFound'),
  InvalidSignature: createError('InvalidSignature'),
  InvalidAuthor: createError('InvalidAuthor'),
  InvalidVersion: createError('InvalidVersion'),
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
  Exists: createError('Exists'),
  HttpError: (code, message) => {
    const err = new HttpError(message)
    err.status = code
    return err
  },
  Timeout: createError('Timeout'),
  export: (err:Error): {
    type:string,
    message:string
  } => {
    return pick(err, ['message', 'stack', 'name', 'type'])
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
    const { type } = errType
    if (!type) return false

    const { name='' } = err
    return name.toLowerCase() === type.toLowerCase()
  },
  ignore,
  rethrow,
  matches
}

export = errors
