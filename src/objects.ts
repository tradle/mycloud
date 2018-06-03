import pick from 'lodash/pick'
import clone from 'lodash/clone'
import cloneDeep from 'lodash/cloneDeep'
import Embed from '@tradle/embed'
import { protocol } from '@tradle/engine'
import { IDebug, ITradleObject, IRetryableTaskOpts, S3Utils, Bucket, Buckets, Logger, Env } from './types'
import * as types from './typeforce-types'
import Errors from './errors'
import { TYPE, PREVLINK, PERMALINK, OWNER } from './constants'
import {
  typeforce,
  omitVirtual,
  setVirtual,
  download,
  summarizeObject,
  ensureTimestamped,
  logifyFunction,
  RESOLVED_PROMISE,
} from './utils'
import { extractSigPubKey, getLinks } from './crypto'
import { MiddlewareContainer } from './middleware-container'
// const { get, put, createPresignedUrl } = require('./s3-utils')
import { prettify } from './string-utils'
import { RetryableTask } from './retryable-task'

type ObjectMetadata = {
  _sigPubKey: string
  _link: string
  _permalink: string
  _prevlink?: string
}

type ObjectsOpts = {
  env: Env
  buckets: Buckets
  s3Utils: S3Utils
  logger: Logger
}

export default class Objects {
  private components: ObjectsOpts

  // lazy-load to avoid circular refs
  private get env () {
    return this.components.env
  }

  private get logger () {
    return this.components.logger
  }

  private get s3Utils () {
    return this.components.s3Utils
  }

  private region: string
  private bucket: Bucket
  // private mediaBucket: Bucket
  private fileUploadBucketName: string
  private middleware: MiddlewareContainer
  constructor (components: ObjectsOpts) {
    // lazy-load the rest to avoid circular refs
    const { env, buckets, logger } = components
    this.components = components
    this.region = env.REGION
    // this.mediaBucket = buckets.FileUpload
    this.bucket = buckets.Objects
    this.fileUploadBucketName = buckets.FileUpload.name
    this.middleware = new MiddlewareContainer({
      logger: logger.sub('mid'),
      getContextForEvent: (event, object) => ({
        event: object
      })
    })

    this.middleware.hookSimple('put', this._put)

    // logging
    this.put = logifyFunction({
      fn: this.put.bind(this),
      name: obj => `Objects.put ${obj[TYPE]}`,
      logger,
      level: 'silly'
    })

    this.get = logifyFunction({
      fn: this.get.bind(this),
      name: link => `Objects.get ${link}`,
      logger,
      level: 'silly'
    })
  }

  // public validate = (object:ITradleObject) => {
  //   try {
  //     extractSigPubKey(object)
  //   } catch (err) {
  //     throw new InvalidSignature(`for ${object[TYPE]}`)
  //   }
  // }

  public getMetadata = (object:ITradleObject, forceRecalc?:boolean):ObjectMetadata => {
    typeforce(types.signedObject, object)

    if (this.env.TESTING) {
      this._ensureNoS3Urls(object)
    }

    const type = object[TYPE]
    // if (object._sigPubKey) {
    //   this.logger.warn('object has "_sigPubKey", be sure you validated it!', {
    //     object,
    //     stack: new Error().stack
    //   })
    // } else {
    let _sigPubKey = forceRecalc ? null : object._sigPubKey
    if (!_sigPubKey) {
      try {
        _sigPubKey = extractSigPubKey(object).pub
      } catch (err) {
        this.logger.error('invalid object', {
          object,
          error: err.stack
        })

        throw new Errors.InvalidSignature(`for ${type}`)
      }
    }

    const { link, permalink, prevlink } = getLinks(object)
    const ret = {
      _sigPubKey,
      _link: link,
      _permalink: permalink
    } as ObjectMetadata

    if (prevlink) ret._prevlink = prevlink

    return ret
  }

  public addMetadata = <T extends ITradleObject>(object:T, forceRecalc?:boolean):T => {
    if (!forceRecalc && object._sigPubKey && object._link && object._permalink) {
      return object
    }

    return setVirtual(object, this.getMetadata(object))
  }

  private _replaceDataUrls = (object:ITradleObject):any[] => {
    return Embed.replaceDataUrls({
      region: this.region,
      bucket: this.fileUploadBucketName,
      keyPrefix: '',
      object
    })
  }

  public replaceEmbeds = async (object:ITradleObject) => {
    const replacements = this._replaceDataUrls(object)
    if (!replacements.length) return

    this.logger.debug(`replaced ${replacements.length} embedded media`)
    await Promise.all(replacements.map(replacement => {
      const { bucket, key, body, mimetype } = replacement
      return this.s3Utils.put({
        bucket,
        key,
        value: body,
        headers: {
          ContentType: mimetype
        }
      })
    }))
  }

  public resolveEmbed = async (embed):Promise<any> => {
    this.logger.debug(`resolving embedded media`, pick(embed, ['url', 'key', 'bucket']))

    const { presigned, key, bucket } = embed
    if (embed.presigned) {
      return await download(embed)
    }

    const { Body, ContentType } = await this.s3Utils.get({ key, bucket })
    if (ContentType === 'binary/octet-stream') {
      throw new Error(`received embed with incorrect mime type: ${ContentType}`)
    }

    // @ts-ignore
    Body.mimetype = ContentType
    return Body
  }

  public resolveEmbeds = async (object:ITradleObject):Promise<ITradleObject> => {
    return await Embed.resolveEmbeds({ object, resolve: this.resolveEmbed })
  }

  public getWithRetry = async (link: string, opts: IRetryableTaskOpts) => {
    const task = new RetryableTask(opts)
    this.logger.silly('getting with retry', link)
    return await task.run(() => this.get(link))
  }

  public get = async (link: string):Promise<ITradleObject> => {
    typeforce(typeforce.String, link)
    return await this.bucket.getJSON(link)
  }

  private _ensureNoDataUrls = object => {
    const replacements = this._replaceDataUrls(cloneDeep(object))
    if (replacements.length) {
      throw new Error(`expected no data urls: ${prettify(object)}`)
    }
  }

  private _ensureNoS3Urls = object => {
    const embeds = Embed.getEmbeds(object)
    if (embeds.length) {
      throw new Error(`expected raw embeds, instead have linked: ${prettify(object)}`)
    }
  }

  public put = async (object: ITradleObject) => {
    return await this.middleware.fire('put', object)
  }

  public _put = async (object: ITradleObject) => {
    typeforce(types.signedObject, object)
    object = clone(object)
    this.addMetadata(object)
    if (this.env.TESTING) {
      this._ensureNoDataUrls(object)
    }

    // this.logger.debug('putting', summarizeObject(object))
    return await this.bucket.putJSON(object._link, object)
  }

  public hook = (event, handler) => this.middleware.hook(event, handler)

  public prefetch = (link: string):void => {
    // prime cache
    this.get(link)
  }

  public del = async (link: string):Promise<void> => {
    await this.bucket.del(link)
  }

  public presignEmbeddedMediaLinks = (opts: {
    object: ITradleObject,
    stripEmbedPrefix?: boolean
  }):ITradleObject => {
    const { object, stripEmbedPrefix } = opts
    if (!object) throw new Errors.InvalidInput('expected "object"')

    Embed.presignUrls({
      object,
      sign: ({ bucket, key, path }) => {
        this.logger.debug('pre-signing url for', {
          type: object[TYPE],
          property: path
        })

        return this.s3Utils.createPresignedUrl({ bucket, key })
      }
    })

    if (stripEmbedPrefix) {
      Embed.stripEmbedPrefix(object)
    }

    return object
  }

}

export { Objects }
