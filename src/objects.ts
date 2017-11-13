import * as Embed from '@tradle/embed'
import { protocol } from '@tradle/engine'
import { IDebug, ITradleObject } from './types'
import * as types from './typeforce-types'
import { InvalidSignature, InvalidAuthor, InvalidVersion, NotFound } from './errors'
import { TYPE, PREVLINK, PERMALINK } from './constants'
import {
  deepClone,
  typeforce,
  setVirtual,
  download,
  pick,
  summarizeObject,
  RESOLVED_PROMISE
} from './utils'
import { extractSigPubKey, addLinks } from './crypto'
// const { get, put, createPresignedUrl } = require('./s3-utils')
import Env from './env'
import Tradle from './tradle'
import Logger from './logger'

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
    const { env, buckets, s3Utils } = tradle
    this.tradle = tradle
    this.env = env
    this.region = env.REGION
    this.buckets = buckets
    this.bucket = this.buckets.Objects
    this.s3Utils = s3Utils
    this.fileUploadBucketName = buckets.FileUpload.name
    this.logger = env.sublogger('objects')
  }

  public addMetadata = (object:ITradleObject):ITradleObject => {
    typeforce(types.signedObject, object)

    const type = object[TYPE]
    if (!object._sigPubKey) {
      let pubKey
      try {
        pubKey = extractSigPubKey(object)
      } catch (err) {
        this.logger.error('invalid object', {
          object,
          error: err.stack
        })

        throw new InvalidSignature(`for ${type}`)
      }

      setVirtual(object, { _sigPubKey: pubKey.pub })
    }

    addLinks(object)
    return object
  }

  public replaceEmbeds = async (object: ITradleObject) => {
    const replacements = Embed.replaceDataUrls({
      region: this.region,
      bucket: this.fileUploadBucketName,
      keyPrefix: '',
      object
    })

    if (replacements.length) {
      this.logger.debug(`replaced ${replacements.length} embedded media`)
      await Promise.all(replacements.map(replacement => {
        const { bucket, key, body, mimetype } = replacement
        return this.s3Utils.put({ bucket, key, value: body, contentType: mimetype })
      }))
    }
  }

  public resolveEmbed = (embed):Promise<any> => {
    this.logger.debug(`resolving embedded media: ${embed.url}`)
    return embed.presigned
      ? download(embed)
      : this.s3Utils.get(embed).then(({ Body, ContentType }) => {
          Body.mimetype = ContentType
          return Body
        })
  }

  public resolveEmbeds = (object:ITradleObject):Promise<ITradleObject> => {
    return Embed.resolveEmbeds({ object, resolve: this.resolveEmbed })
  }

  public get = (link: string):Promise<ITradleObject> => {
    typeforce(typeforce.String, link)
    this.logger.debug('getting', link)
    return this.bucket.getJSON(link)
  }

  public put = async (object: ITradleObject) => {
    typeforce(types.signedObject, object)
    this.addMetadata(object)
    object = deepClone(object)
    await this.replaceEmbeds(object)
    this.logger.debug('putting', summarizeObject(object))
    return this.bucket.putJSON(object._link, object)
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
