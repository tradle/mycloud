import clone from "lodash/clone"
import cloneDeep from "lodash/cloneDeep"
import {
  ITradleObject,
  IRetryableTaskOpts,
  KeyValueStore,
  Logger,
  Env,
  EmbedResolver,
  PresignEmbeddedMediaOpts
} from "./types"

import * as types from "./typeforce-types"
import Errors from "./errors"
import { TYPE } from "./constants"
import { typeforce, setVirtual, download, logifyFunction } from "./utils"
import { extractSigPubKey, getLinks } from "./crypto"
import { MiddlewareContainer } from "./middleware-container"
// const { get, put, createPresignedUrl } = require('./s3-utils')
import { prettify } from "./string-utils"
import { RetryableTask } from "./retryable-task"

type ObjectMetadata = {
  _sigPubKey: string
  _link: string
  _permalink: string
  _prevlink?: string
}

type ObjectsOpts = {
  objectStore: KeyValueStore
  embeds: EmbedResolver
  logger: Logger
}

export default class Objects {
  private middleware: MiddlewareContainer
  constructor(private opts: ObjectsOpts) {
    const { logger } = opts
    this.middleware = new MiddlewareContainer({
      logger: logger.sub("mid"),
      getContextForEvent: (event, object) => ({
        event: object
      })
    })

    this.middleware.hookSimple("put", this._put)

    // logging
    this.put = logifyFunction({
      fn: this.put.bind(this),
      name: obj => `Objects.put ${obj[TYPE]}`,
      logger,
      level: "silly"
    })

    this.get = logifyFunction({
      fn: this.get.bind(this),
      name: link => `Objects.get ${link}`,
      logger,
      level: "silly"
    })
  }

  // public validate = (object:ITradleObject) => {
  //   try {
  //     extractSigPubKey(object)
  //   } catch (err) {
  //     throw new InvalidSignature(`for ${object[TYPE]}`)
  //   }
  // }

  public getMetadata = (object: ITradleObject, forceRecalc?: boolean): ObjectMetadata => {
    typeforce(types.signedObject, object)

    this.throwIfHasUnresolvedEmbeds(object)
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
        this.opts.logger.error("invalid object", {
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

  public addMetadata = <T extends ITradleObject>(object: T, forceRecalc?: boolean): T => {
    if (!forceRecalc && object._sigPubKey && object._link && object._permalink) {
      return object
    }

    return setVirtual(object, this.getMetadata(object))
  }

  public replaceEmbeddedMedia = async (object: ITradleObject) => {
    return this.opts.embeds.replaceEmbeddedMedia(object)
  }

  public resolveEmbeds = async (object: ITradleObject): Promise<ITradleObject> => {
    return await this.opts.embeds.resolveAll(object)
  }

  public presignEmbeddedMediaLinks = (opts: PresignEmbeddedMediaOpts<ITradleObject>) =>
    this.opts.embeds.presignEmbeddedMedia(opts)

  public getWithRetry = async (link: string, opts: IRetryableTaskOpts) => {
    const task = new RetryableTask(opts)
    this.opts.logger.silly("getting with retry", link)
    return await task.run(() => this.get(link))
  }

  public get = async (link: string): Promise<ITradleObject> => {
    typeforce(typeforce.String, link)
    return await this.opts.objectStore.get(link)
  }

  public throwIfHasInlinedEmbeds = object => {
    const replacements = this.opts.embeds.replaceDataUrls(cloneDeep(object))
    if (replacements.length) {
      throw new Error(`expected no data urls: ${prettify(object)}`)
    }
  }

  public throwIfHasUnresolvedEmbeds = object => {
    const embeds = this.opts.embeds.getEmbeds(object)
    if (embeds.length) {
      throw new Error(`expected raw embeds, instead have linked: ${prettify(object)}`)
    }
  }

  public put = async (object: ITradleObject) => {
    await this.middleware.fire("put", object)
  }

  public _put = async (object: ITradleObject) => {
    typeforce(types.signedObject, object)
    this.throwIfHasInlinedEmbeds(object)

    object = clone(object)
    this.addMetadata(object)

    // this.logger.debug('putting', summarizeObject(object))
    await this.opts.objectStore.put(object._link, object)
  }

  public hook = (event, handler) => this.middleware.hook(event, handler)

  public prefetch = (link: string): void => {
    // prime cache
    this.get(link).catch(Errors.ignoreNotFound)
  }

  public del = async (link: string): Promise<void> => {
    await this.opts.objectStore.del(link)
  }
}

export const createObjects = (opts: ObjectsOpts) => new Objects(opts)

export { Objects }
