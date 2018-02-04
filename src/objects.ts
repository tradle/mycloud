import _ = require('lodash')
import Embed = require('@tradle/embed')
import { protocol } from '@tradle/engine'
import { IDebug, ITradleObject } from './types'
import types = require('./typeforce-types')
import { InvalidSignature, InvalidAuthor, InvalidVersion, NotFound } from './errors'
import { TYPE, PREVLINK, PERMALINK } from './constants'
import {
  typeforce,
  omitVirtual,
  setVirtual,
  download,
  summarizeObject,
  ensureTimestamped,
  RESOLVED_PROMISE,
} from './utils'
import { extractSigPubKey, getLinks } from './crypto'
// const { get, put, createPresignedUrl } = require('./s3-utils')
import Env from './env'
import Tradle from './tradle'
import Logger from './logger'
import { prettify } from './string-utils'

type ObjectMetadata = {
  _sigPubKey: string
  _link: string
  _permalink: string
  _prevlink?: string
}

export default class Objects {
  private tradle: Tradle
  private env: Env
  private logger: Logger
  private region: string
  private buckets: any
  private bucket: any
  private s3Utils: any
  private fileUploadBucketName: string
  constructor (tradle: Tradle) {
    const { env, buckets, s3Utils, logger } = tradle
    this.tradle = tradle
    this.env = env
    this.region = env.REGION
    this.buckets = buckets
    this.bucket = this.buckets.Objects
    this.s3Utils = s3Utils
    this.fileUploadBucketName = buckets.FileUpload.name
    this.logger = logger.sub('objects')
  }

  public validate = (object:ITradleObject) => {
    try {
      extractSigPubKey(object)
    } catch (err) {
      throw new InvalidSignature(`for ${object[TYPE]}`)
    }
  }

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

        throw new InvalidSignature(`for ${type}`)
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

  public addMetadata = (object:ITradleObject, forceRecalc?:boolean):ITradleObject => {
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
    this.logger.debug(`resolving embedded media: ${embed.url}`)
    const { presigned, key, bucket } = embed
    if (embed.presigned) {
      return await download(embed)
    }

    const { Body, ContentType } = await this.s3Utils.get({ key, bucket })
    if (ContentType === 'binary/octet-stream') {
      throw new Error(`received embed with incorrect mime type: ${ContentType}`)
    }

    Body.mimetype = ContentType
    return Body
  }

  public resolveEmbeds = async (object:ITradleObject):Promise<ITradleObject> => {
    return await Embed.resolveEmbeds({ object, resolve: this.resolveEmbed })
  }

  public get = async (link: string):Promise<ITradleObject> => {
    typeforce(typeforce.String, link)
    this.logger.debug('getting', link)
    return await this.bucket.getJSON(link)
  }

  private _ensureNoDataUrls = object => {
    const replacements = this._replaceDataUrls(_.cloneDeep(object))
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
    typeforce(types.signedObject, object)
    object = _.clone(object)
    ensureTimestamped(object)
    this.addMetadata(object)
    if (this.env.TESTING) {
      this._ensureNoDataUrls(object)
    }

    this.logger.debug('putting', summarizeObject(object))
    return await this.bucket.putJSON(object._link, object)
  }

  public prefetch = (link: string):void => {
    // prime cache
    this.get(link)
  }

  public del = async (link: string):Promise<void> => {
    await this.bucket.del(link)
  }

  public presignEmbeddedMediaLinks = (opts: {
    object: ITradleObject,
    stripEmbedPrefix: boolean
  }):ITradleObject => {
    const { object, stripEmbedPrefix } = opts
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

  public validateNewVersion = async (opts: { object: ITradleObject }) => {
    // lazy access 'identities' property, to avoid circular reference
    const { identities } = this.tradle
    const { object } = opts
    const previous = await this.get(object[PREVLINK])

    await Promise.all([
      object._author ? RESOLVED_PROMISE : identities.addAuthorInfo(object),
      previous._author ? RESOLVED_PROMISE : identities.addAuthorInfo(previous)
    ])

    if (object._author !== previous._author) {
      throw new InvalidAuthor(`expected ${previous._author}, got ${object._author}`)
    }

    try {
      protocol.validateVersioning({
        object,
        prev: previous,
        orig: object[PERMALINK]
      })
    } catch (err) {
      throw new InvalidVersion(err.message)
    }
  }
}

export { Objects }
