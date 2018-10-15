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

export interface RequestInfo {
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
}

const ORIGINALS:HttpModules = {
  http: _.pick(http, 'request'),
  https: _.pick(https, 'request')
}

class RequestInterceptor extends EventEmitter {
  private isEnabled: boolean
  private pending: RequestInfo[]
  constructor() {
    super()
    this.isEnabled = false
    this.pending = []
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

    return req
  }

  public freeze = (identifier: string) => this.pending.forEach(req => {
    req.freezeId = identifier
  })

  public getPending = () => this.pending.slice()
}

export const requestInterceptor = new RequestInterceptor()
