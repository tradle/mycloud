import pick from 'lodash/pick'
import Embed from '@tradle/embed'
import { S3Client } from '@tradle/aws-s3-client'
import {
  EmbedResolver,
  Logger,
  PresignEmbeddedMediaOpts,
  ITradleObject,
  ParsedMediaEmbed,
  ParsedRelocatedEmbedUrl
} from '../types'
import { download } from '../utils'

interface CreateResolverOpts {
  client: S3Client
  region: string
  bucket: string
  keyPrefix: string
  logger: Logger
}

interface S3EmbedInfo extends ParsedMediaEmbed {
  s3Url: string
  bucket: string
  key: string
}

interface ParsedS3EmbedUrl extends ParsedRelocatedEmbedUrl {
  bucket: string
  key: string
}

export const createResolver = (opts: CreateResolverOpts): EmbedResolver => new S3EmbedResolver(opts)

export class S3EmbedResolver implements EmbedResolver {
  constructor(private opts: CreateResolverOpts) {}
  public replaceDataUrls = (object: ITradleObject): S3EmbedInfo[] =>
    Embed.replaceDataUrls({
      region: this.opts.region,
      bucket: this.opts.bucket,
      keyPrefix: this.opts.keyPrefix,
      object
    })

  public presignEmbeddedMedia = <T>({ object, stripEmbedPrefix }: PresignEmbeddedMediaOpts<T>) => {
    Embed.presignUrls({
      object,
      sign: ({ bucket, key, path }) => {
        this.opts.logger.debug('pre-signing url for', {
          // @ts-ignore
          type: object._t,
          property: path
        })

        return this.opts.client.createPresignedUrl({ bucket, key })
      }
    })

    if (stripEmbedPrefix) {
      Embed.stripEmbedPrefix(object)
    }

    return object
  }

  public replaceEmbeddedMedia = async (object: ITradleObject) => {
    const replacements = await this.replaceDataUrls(object)
    if (!replacements.length) return

    await Promise.all(
      replacements.map(replacement => {
        const { bucket, key, body, mimetype } = replacement
        return this.opts.client.put({
          bucket,
          key,
          value: body,
          headers: {
            ContentType: mimetype
          }
        })
      })
    )

    this.opts.logger.debug(`replaced ${replacements.length} embedded media`)
  }

  public resolveOne = async (embed: ParsedS3EmbedUrl): Promise<any> => {
    this.opts.logger.debug(`resolving embedded media`, pick(embed, ['url', 'key', 'bucket']))

    const { presigned, key, bucket } = embed
    if (presigned) {
      return await download(embed)
    }

    const { Body, ContentType } = await this.opts.client.get({ key, bucket })
    if (ContentType === 'binary/octet-stream') {
      throw new Error(`received embed with incorrect mime type: ${ContentType}`)
    }

    // @ts-ignore
    Body.mimetype = ContentType
    return Body
  }

  public resolveAll = async object => Embed.resolveEmbeds({ object, resolve: this.resolveOne })
  public getEmbeds = (object: any): ParsedS3EmbedUrl[] => Embed.getEmbeds(object)
}
