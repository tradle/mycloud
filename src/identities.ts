import { extend } from 'lodash'
import Cache from 'lru-cache'
import constants from './constants'
import Errors from './errors'
import {
  firstSuccess,
  logify,
  typeforce,
  omitVirtual,
  setVirtual,
  bindAll,
  cachifyFunction,
  RESOLVED_PROMISE
} from './utils'

import { addLinks, getLink, getPermalink, extractSigPubKey } from './crypto'
import * as types from './typeforce-types'
import {
  IIdentity,
  ITradleObject,
  Env,
  Logger,
  Objects,
  DB
} from './types'

const { PREVLINK, TYPE, TYPES } = constants
const { MESSAGE } = TYPES
const { NotFound } = Errors
const CACHE_MAX_AGE = 5000
const PUB_KEY = 'tradle.PubKey'

type AuthorInfo = {
  _author: string
  _recipient?: string
}

type PubKeyMapping = {
  link: string
  pub: string
}

export default class Identities {
  public objects: Objects
  public pubKeys: any
  public env: Env
  public logger: Logger
  public cache: any
  public db: DB
  constructor (opts: { db: DB, objects: any, logger: Logger }) {
    logify(this)
    bindAll(this)

    const { db, objects, logger } = opts
    this.objects = objects
    this.db = db
    this.logger = logger.sub('identities')
    this.cache = new Cache({ maxAge: CACHE_MAX_AGE })
    this.metaByPub = cachifyFunction(this, 'metaByPub').call
    this.byPermalink = cachifyFunction(this, 'byPermalink').call
  }

  public metaByPub = async (pub:string) => {
    this.logger.debug('get identity metadata by pub', pub)
    try {
      return await this.db.get({
        [TYPE]: PUB_KEY,
        pub
      })
    } catch (err) {
      Errors.ignoreNotFound(err)
      throw new Errors.UnknownAuthor(`with pub: ${pub}`)
    }
  }

  public byPub = async (pub:string):Promise<IIdentity> => {
    const { link } = await this.metaByPub(pub)
    try {
      const identity = await this.objects.get(link)
      return identity as IIdentity
    } catch(err) {
      this.logger.debug('unknown identity', {
        pub,
        error: err.stack
      })

      throw new Errors.UnknownAuthor('with pub: ' + pub)
    }
  }

  // public sigPubKeysByPermalink = async (permalink:string):Promise<string[]> => {
  //   const params = {
  //     IndexName: 'permalink',
  //     KeyConditionExpression: 'permalink = :permalinkValue',
  //     FilterExpression: '#type = :type AND #purpose = :purpose',
  //     ExpressionAttributeNames: {
  //       '#type': 'type',
  //       '#purpose': 'purpose'
  //     },
  //     ExpressionAttributeValues: {
  //       ':permalinkValue': permalink,
  //       ':type': 'ec',
  //       ':purpose': 'messaging'
  //     }
  //   }

  //   this.logger.debug('get sig pub keys by permalink')
  //   const results = await this.pubKeys.find(params)
  //   if (!results.length) {
  //     this.logger.debug('unknown identity', { permalink })
  //     throw new NotFound('identity with permalink: ' + permalink)
  //   }

  //   return results
  // }

  public byPermalink = async (permalink: string):Promise<IIdentity> => {
    this.logger.debug('get identity by permalink')
    const { link } = await this.db.findOne({
      select: ['link'],
      filter: {
        EQ: {
          [TYPE]: PUB_KEY,
          permalink
        }
      }
    })

    try {
      const identity = await this.objects.get(link)
      return identity as IIdentity
    } catch(err) {
      this.logger.debug('unknown identity', { permalink })
      throw new NotFound('identity with permalink: ' + permalink)
    }
  }

// function getIdentityByFingerprint ({ fingerprint }) {
//   const params = {
//     TableName: PubKeys,
//     IndexName: 'fingerprint',
//     KeyConditionExpression: '#fingerprint = :fingerprintValue',
//     ExpressionAttributeNames: {
//       "#fingerprint": 'fingerprint'
//     },
//     ExpressionAttributeValues: {
//       ":fingerprintValue": fingerprint
//     }
//   }

//   return findOne(params)
//     .then(this.objects.get)
// }

  public getExistingIdentityMapping = async (identity):Promise<PubKeyMapping> => {
    this.logger.debug('checking existing mappings for pub keys')
    const lookups = identity.pubkeys.map(obj => this.metaByPub(obj.pub))
    return firstSuccess(lookups)
  }

// function getExistingIdentityMapping ({ identity }) {
//   const pubKeys = identity.pubkeys.map(pub => pub.pub)
//   const KeyConditionExpression = `#pub IN (${pubKeys.map((pub, i) => `:pubValue${i}`).join(',')})`
//   const ExpressionAttributeValues = {}
//   pubKeys.forEach((pub, i) => {
//     ExpressionAttributeValues[`:pubValue${i}`] = pub
//   })

//   const params = {
//     TableName: PubKeys,
//     IndexName: 'permalink',
//     KeyConditionExpression,
//     ExpressionAttributeNames: {
//       "#pub": "pub"
//     },
//     ExpressionAttributeValues
//   }

//   console.log(params)
//   return findOne(params)
// }

// async createAddContactEvent ({ link, permalink, object }) {
//   const result = validateNewContact({ link, permalink, object })
//   debug(`queueing add contact ${link}`)
//   await Events.putEvent({
//     topic: 'addcontact',
//     link: result.link
//   })
// })

  public validateNewContact = async (identity) => {
    identity = omitVirtual(identity)
    if (identity._link || identity._permalink) {
      throw new Errors.InvalidInput(`evil identity has non-virtual _link, _permalink`)
    }

    const { link, permalink } = addLinks(identity)
    let existing
    try {
      // existing = await this.byPermalink(permalink)
      // if (!existing) {
      const { link } = await this.getExistingIdentityMapping(identity)
      existing = await this.objects.get(link)
      // }
    } catch (err) {}

    if (existing) {
      if (existing.link === link) {
        this.logger.debug(`mapping is already up to date for identity ${permalink}`)
      } else if (identity[PREVLINK] !== existing.link) {
        this.logger.warn('identity mapping collision. Refusing to add contact:', identity)
        throw new Error(`refusing to add identity with link: "${link}"`)
      }
    }

    const sigPubKey = extractSigPubKey(identity)
    const hasSigPubKey = (existing || identity).pubkeys
      .filter(isUpdateKey)
      .find(({ pub }) => pub === sigPubKey.pub)

    if (!hasSigPubKey) {
      throw new Errors.InvalidVersion(`expected identity version to be signed with an 'update' key from the previous version`)
    }

    return {
      identity: existing || identity,
      exists: !!existing
    }
  }

  public addContactWithoutValidating = async (object: IIdentity):Promise<void> => {
    if (object) {
      typeforce(types.identity, object)
    } else {
      object = (await this.objects.get(getLink(object)) as IIdentity)
    }

    const { link, permalink } = addLinks(object)
    const putPubKeys = object.pubkeys
      .map(({ pub }) => this.putPubKey({ pub, link, permalink }))

    this.logger.info('adding contact', { permalink })
    await Promise.all(putPubKeys.concat(this.objects.put(object)))
  }

  public putPubKey = (props: { link: string, permalink: string, pub: string }):Promise<any> => {
    const { pub, link } = props
    this.logger.debug('adding mapping', {
      pub,
      link
    })

    this.cache.set(pub, props)
    return this.db.put(extend({
      [TYPE]: PUB_KEY,
      _time: Date.now(),
    }, props))
  }

  /**
   * Add author metadata, including designated recipient, if object is a message
   * @param {String} object._sigPubKey author sigPubKey
   */
  public getAuthorInfo = async (object: ITradleObject):Promise<AuthorInfo> => {
    const { _sigPubKey } = this.objects.getMetadata(object)
    const type = object[TYPE]
    const isMessage = type === MESSAGE
    const pub = isMessage && object.recipientPubKey.pub.toString('hex')
    const { author, recipient } = {
      author: await this.metaByPub(_sigPubKey),
      recipient: await (pub ? this.metaByPub(pub) : RESOLVED_PROMISE)
    }

    const ret = {
      _author: author.permalink
    } as AuthorInfo

    if (recipient) ret._recipient = recipient.permalink

    return ret
  }

  public addAuthorInfo = async (object: ITradleObject):Promise<ITradleObject> => {
    const info = await this.getAuthorInfo(object)
    return setVirtual(object, info)
  }

  public addContact = async (identity:IIdentity):Promise<void> => {
    const result = await this.validateNewContact(identity)
    // debug('validated contact:', prettify(result))
    if (!result.exists) {
      await this.addContactWithoutValidating(result.identity)
    }
  }
}

export { Identities }

const isUpdateKey = key => key.type === 'ec' && key.purpose === 'update'

// function addContactPubKeys ({ link, permalink, identity }) {
//   const RequestItems = {
//     [PubKeys]: identity.pubkeys.map(pub => {
//       const Item = extend({ link, permalink }, pub)
//       return {
//         PutRequest: { Item }
//       }
//     })
//   }

//   return docClient.batchWrite({ RequestItems }).promise()
// }

// const Identities = module.exports = logify({
//   getIdentityByLink: this.objects.get,
//   byPermalink,
//   byPub,
//   metaByPub,
//   // getIdentityByFingerprint,
//   // createAddContactEvent,
//   addContact,
//   validateNewContact,
//   addContact,
//   addAuthorInfo
// })
