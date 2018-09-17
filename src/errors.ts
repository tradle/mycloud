// const debug = require('debug')('tradle:sls:errors')
import _ from 'lodash'

import ex from 'error-ex'
import { AssertionError } from 'assert'
import { TfTypeError, TfPropertyTypeError } from 'typeforce'
import { LowFundsInput } from './types'

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
  ],
  developer: [
    'system',
    {
      // dynamodb
      code: 'ValidationException'
    }
  ]
}

const isSystemError = err => types.system.some(ErrorCtor => {
  return err instanceof ErrorCtor
})

const matches = (err, type) => {
  if (!(err && type)) {
    throw new Error('expected error and match parameters')
  }

  if (type in types) {
    // resolve alias
    return matches(err, types[type])
  }

  if (Array.isArray(type)) {
    return type.some(subType => matches(err, subType))
  }

  if (typeof type === 'function') {
    return err instanceof type
  }

  for (let key in type) {
    let expected = type[key]
    let actual = err[key]
    if (expected instanceof RegExp) {
      if (!expected.test(actual)) {
        return false
      }
    } else if (!_.isEqual(expected, actual)) {
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

const copyStackFrom = (source, target) => {
  target.stack = target.stack.split('\n').slice(0,2).join('\n') + '\n' + source.stack
}

const rethrowAs = (original, errToThrow) => {
  copyStackFrom(original, errToThrow)
  throw errToThrow
}

const _HttpError = createError('HttpError')

class ExportableError extends Error {
  public toJSON = () => exportError(this)
}

class HttpError extends ExportableError {
  public name = 'HttpError'
  public status: number
  constructor(code, message) {
    super(message)
    this.status = code || 500
  }

  public toJSON = () => ({ ...exportError(this), status: this.status })
}

class ErrorWithLink extends ExportableError {
  public link: string
  constructor(message, link) {
    super(message)
    this.link = link
  }

  public toJSON = () => ({ ...exportError(this), link: this.link })
}

class CloudServiceError extends Error {
  public service: string
  public retryable: boolean
  constructor (opts: {
    message:string,
    service:string,
    retryable: boolean,
    [x:string]: any
  }) {
    super(opts.message)
    _.extend(this, opts)
  }
}

class Duplicate extends ErrorWithLink {
  public name = 'DuplicateError'
}

class TimeTravel extends ErrorWithLink {
  public name = 'TimeTravelError'
}

type StringOrNum = string|number

const getLowFundsMessage = ({
  blockchain,
  networkName,
  address,
  balance,
  minBalance,
}: LowFundsInput) => {
  const prefix = `blockchain ${blockchain} network ${networkName} address ${address} balance is`
  if (_.isUndefined(balance) || _.isUndefined(minBalance)) {
    return `${prefix} low`
  }

  return `${prefix} ${balance}, need at least ${minBalance}`
}

class LowFunds extends Error implements LowFundsInput {
  public address: string
  public blockchain: string
  public networkName: string
  public balance?: StringOrNum
  public minBalance?: StringOrNum
  constructor(opts: LowFundsInput) {
    super(getLowFundsMessage(opts))
    const {
      blockchain,
      networkName,
      address,
      balance,
      minBalance,
    } = opts

    this.address = address
    this.blockchain = blockchain
    this.networkName = networkName
    this.balance = balance
    this.minBalance = minBalance
  }
}

const exportError = (err:Error) => {
  const obj:any = _.pick(err, ['message', 'stack', 'name', 'type'])
  if (obj.type && obj.message && !obj.message.startsWith(obj.type)) {
    obj.message = `${obj.type}: ${obj.message}`
  }

  return obj
}

const NOT_FOUND_MATCH = [
  { name: 'NotFound' },
  { code: 'ResourceNotFoundException' },
  { code: 'NoSuchKey' },
  { code: 'NoSuchBucketPolicy' },
]

const errors = {
  ClientUnreachable: createError('ClientUnreachable'),
  NotFound: createError('NotFound'),
  Forbidden: createError('Forbidden'),
  Expired: createError('Expired'),
  InvalidSignature: createError('InvalidSignature'),
  InvalidAuthor: createError('InvalidAuthor'),
  UnknownAuthor: createError('UnknownAuthor'),
  InvalidVersion: createError('InvalidVersion'),
  InvalidMessageFormat: createError('InvalidMessageFormat'),
  InvalidObjectFormat: createError('InvalidObjectFormat'),
  PutFailed: createError('PutFailed'),
  MessageNotForMe: createError('MessageNotForMe'),
  HandshakeFailed: createError('HandshakeFailed'),
  LambdaInvalidInvocation: createError('LambdaInvalidInvocation'),
  InvalidInput: createError('InvalidInput'),
  InvalidEnvironment: createError('InvalidEnvironment'),
  ClockDrift: createError('ClockDrift'),
  BatchPutFailed: createError('BatchPutFailed'),
  ErrorWithLink,
  Duplicate,
  TimeTravel,
  CloudServiceError,
  ExecutionTimeout: createError('ExecutionTimeout'),
  Exists: createError('Exists'),
  HttpError,
  Timeout: createError('Timeout'),
  LowFunds,
  DevStageOnly: createError('DevStageOnly'),
  Unsupported: createError('Unsupported'),
  GaveUp: createError('GaveUp'),
  export: (err:Error):any => {
    if (err instanceof ExportableError) {
      return (err as ExportableError).toJSON()

    }
    return exportError(err)
  },
  isDeveloperError: (err:Error): boolean => {
    return matches(err, 'developer')
  },
  isCustomError: (err:Error): boolean => {
    return err.name in errors
  },
  isNotFound: err => {
    return matches(err, NOT_FOUND_MATCH)
  },
  ignoreNotFound: err => {
    ignore(err, NOT_FOUND_MATCH)
  },
  ignoreUnmetCondition: err => {
    ignore(err, { code: 'ConditionalCheckFailedException' })
  },
  // @ts-ignore
  ignoreAll: err => {},
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
  matches,
  createClass: createError,
  copyStackFrom,
  rethrowAs,
}

export = errors
