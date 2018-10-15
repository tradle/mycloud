import http from 'http'
import https from 'https'
import { EventEmitter } from 'events'
import util from 'util'
import url from 'url'
import _ from 'lodash'

type HttpModules = {
  http: any
  https: any
}

type HttpRequestOptions = http.RequestOptions | string | URL

interface ResponseInfo {
  statusCode: number
  statusText?: string
}

interface RequestInfo {
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
}

class RequestInterceptor extends EventEmitter {
  private isEnabled: boolean
  private originals: HttpModules
  private pending: RequestInfo[]
  constructor() {
    super()
    this.isEnabled = false
    this.originals = {
      http: null,
      https: null,
    }

    this.pending = []
  }

  public enable = () => {
    if (this.isEnabled) return

    this.isEnabled = true
    this.originals = {
      http: _.pick(http, 'request'),
      https: _.pick(https, 'request')
    }

    try {
      http.request = (options: HttpRequestOptions, callback) => {
        const req = this.originals.http.request(options, callback)
        return this._watchRequest(req, options)
      }
    } catch (e) {
      this.disable()
      throw e
    }
  }

  public disable = () => {
    if (!this.isEnabled) return

    _.extend(http, this.originals.http)
    _.extend(https, this.originals.https)

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

    this.pending.push(reqInfo)

    const cleanup = _.once((err?: Error) => {
      this.pending.splice(this.pending.indexOf(reqInfo), 1)

      reqInfo.duration = Date.now() - start
      if (err) {
        reqInfo.error = err
        this.emit('error', reqInfo)
      } else {
        this.emit('success', reqInfo)
      }
    })

    this.emit('request', reqInfo)

    req.on('error', cleanup)
    req.on('response', (res) => {
      reqInfo.response = _.pick(res, [
        'statusCode',
        'statusText',
        // 'headers',
        // 'trailers',
        // 'url',
      ]) as ResponseInfo

      res.on('end', () => cleanup())
      res.on('error', cleanup)
    })

    return req
  }
}

export const requestInterceptor = new RequestInterceptor()
