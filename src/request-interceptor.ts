import http from 'http'
import https from 'https'
import { EventEmitter } from 'events'
import util from 'util'
import url from 'url'
import _ from 'lodash'
// import { createLogger, Logger } from './logger'

type HttpModules = {
  http: any
  https: any
}

type HttpRequestOptions = http.RequestOptions | string | URL

interface ResponseInfo {
  statusCode: number
  statusText?: string
}

export interface RequestInfo {
  stack: string
  method: string
  protocol: string
  port: string
  host: string
  hostname?: string
  hash?: string
  search?: string
  query?: string
  pathname?: string
  path?: string
  href?: string
  duration?: number
  response?: ResponseInfo
  error?: Error
  freezeId?: string
  req?: http.ClientRequest
}

const ORIGINALS:HttpModules = {
  http: _.pick(http, 'request'),
  https: _.pick(https, 'request')
}

class RequestInterceptor extends EventEmitter {
  private isEnabled: boolean
  private pending: RequestInfo[]
  // private logger: Logger
  constructor() {
    super()
    this.isEnabled = false
    this.pending = []
    // this.logger = createLogger('global:http')
  }

  public enable = () => {
    if (this.isEnabled) return

    this.isEnabled = true
    try {
      http.request = (options: HttpRequestOptions, callback) => {
        const req = ORIGINALS.http.request(options, callback)
        return this._watchRequest(req, options)
      }
    } catch (e) {
      this.disable()
      throw e
    }
  }

  public disable = () => {
    if (!this.isEnabled) return

    _.extend(http, ORIGINALS.http)
    _.extend(https, ORIGINALS.https)

    this.isEnabled = false
    this.pending.length = 0
  }

  private _watchRequest = (req: http.ClientRequest, options: HttpRequestOptions):http.ClientRequest => {
    const start = Date.now()

    // Extract request logging details
    if (typeof options === 'string') {
      options = url.parse(options)
    }

    const reqInfo = _.pick(options, [
      'method',
      'port',
      'path',
      'host',
      'protocol',
      // 'auth',
      'hostname',
      'hash',
      'search',
      'query',
      'pathname',
      'href'
    ]) as RequestInfo

    reqInfo.stack = new Error('').stack.split('\n').slice(1).join('\n')
    reqInfo.req = req
    this.pending.push(reqInfo)

    const cleanup = _.once((err?: Error) => {
      this._removePending(reqInfo)

      reqInfo.duration = Date.now() - start
      if (err) {
        reqInfo.error = err
        this._emitNeutered('error', reqInfo)
      } else {
        this._emitNeutered('success', reqInfo)
      }
    })

    req.once('error', cleanup)
    req.once('response', res => {
      reqInfo.response = _.pick(res, [
        'statusCode',
        'statusText',
        // 'headers',
        // 'trailers',
        // 'url',
      ]) as ResponseInfo

      res.once('end', cleanup.bind(null, null))
      res.once('error', cleanup)
    })

    this._emitNeutered('request', reqInfo)

    return req
  }

  public freeze = (identifier: string) => this.pending.forEach(req => {
    if (!req.freezeId) {
      req.freezeId = identifier
    }
  })

  public hasPending = () => this.pending.length !== 0
  public getPending = () => this.pending.map(neuter)
  public abortPending = () => {
    if (!this.pending.length) return []

    return this.pending.map(reqInfo => {
      if (reqInfo.req.abort) {
        try {
          reqInfo.req.abort()
        } catch (err) {
          reqInfo.error = err
        }
      }

      this._removePending(reqInfo)
      return reqInfo
    })
  }

  private _emitNeutered = (event: string, reqInfo: RequestInfo) => {
    this.emit(event, neuter(reqInfo))
  }

  private _removePending = (reqInfo: RequestInfo) => {
    const idx = this.pending.indexOf(reqInfo)
    if (idx !== -1) {
      this.pending.splice(idx, 1)
      return true
    }

    return false
  }
}

const neuter = (reqInfo: RequestInfo) => _.omit(reqInfo, 'req') as RequestInfo

export const requestInterceptor = new RequestInterceptor()
