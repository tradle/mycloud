import Debug from 'debug'
const debug = Debug('tradle:sls:objects')
import * as Embed from '@tradle/embed'
import * as types from './typeforce-types'
import { InvalidSignature } from './errors'
import { TYPE, TYPES } from './constants'
import {
  deepClone,
  typeforce,
  setVirtual,
  download
} from './utils'
import { extractSigPubKey, addLinks } from './crypto'
// const { get, put, createPresignedUrl } = require('./s3-utils')

const { MESSAGE } = TYPES

export default class Objects {
  public static addMetadata = (object):any => {
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

  private env: any
  private buckets: any
  private bucket: any
  private s3Utils: any
  private fileUploadBucketName: string
  constructor ({ env, buckets, s3Utils }) {
    this.env = env
    this.buckets = buckets
    this.bucket = this.buckets.Objects
    this.s3Utils = s3Utils
    this.fileUploadBucketName = buckets.FileUpload.name
  }

  public addMetadata = object => Objects.addMetadata(object)

  public replaceEmbeds = async (object) => {
    const replacements = Embed.replaceDataUrls({
      region: this.env.region,
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

  public resolveEmbeds = (object):Promise<any> => {
    return Embed.resolveEmbeds({ object, resolve: this.resolveEmbed })
  }

  public getObjectByLink = (link: string):Promise<any> => {
    typeforce(typeforce.String, link)
    debug('getting', link)
    return this.bucket.getJSON(link)
  }

  public putObject = async (object) => {
    typeforce(types.signedObject, object)
    this.addMetadata(object)
    object = deepClone(object)
    await this.replaceEmbeds(object)
    debug('putting', object[TYPE], object._link)
    return this.bucket.putJSON(object._link, object)
  }

  public prefetchByLink = (link: string):Promise<any> => {
    // prime cache
    return this.getObjectByLink(link)
  }

  public del = (link: string):Promise<any> => {
    return this.bucket.del(link)
  }

  public presignEmbeddedMediaLinks = ({
    object,
    stripEmbedPrefix
  }):any => {
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
}
