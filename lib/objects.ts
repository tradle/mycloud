import Debug from 'debug'
const debug = Debug('tradle:sls:objects')
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
  RESOLVED_PROMISE
} from './utils'
import { extractSigPubKey, addLinks } from './crypto'
// const { get, put, createPresignedUrl } = require('./s3-utils')
import Env from './env'
import Tradle from './tradle'

export default class Objects {
  public static addMetadata = (object:ITradleObject):ITradleObject => {
    typeforce(types.signedObject, object)

    const type = object[TYPE]
    if (!object._sigPubKey) {
      let pubKey
      try {
        pubKey = extractSigPubKey(object)
      } catch (err) {
        debug('invalid object', JSON.stringify(object), err)
        throw new InvalidSignature(`for ${type}`)
      }

      setVirtual(object, { _sigPubKey: pubKey.pub })
    }

    addLinks(object)
    return object
  }

  private tradle: Tradle
  private env: Env
  private debug: IDebug
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
  }

  public addMetadata = object => Objects.addMetadata(object)

  public replaceEmbeds = async (object: ITradleObject) => {
    const replacements = Embed.replaceDataUrls({
      region: this.region,
      bucket: this.fileUploadBucketName,
      keyPrefix: '',
      object
    })

    if (replacements.length) {
      debug(`replaced ${replacements.length} embedded media`)
      await Promise.all(replacements.map(replacement => {
        const { bucket, key, body } = replacement
        return this.s3Utils.put({ bucket, key, value: body })
      }))
    }
  }

  public resolveEmbed = (embed):Promise<any> => {
    debug(`resolving embedded media: ${embed.url}`)
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
    debug('getting', link)
    return this.bucket.getJSON(link)
  }

  public put = async (object: ITradleObject) => {
    typeforce(types.signedObject, object)
    this.addMetadata(object)
    object = deepClone(object)
    await this.replaceEmbeds(object)
    debug('putting', object[TYPE], object._link)
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
        debug(`pre-signing url for ${object[TYPE]} property ${path}`)
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
