import * as constants from './constants'
import * as Errors from './errors'
import {
  firstSuccess,
  logify,
  typeforce,
  omitVirtual,
  setVirtual,
  bindAll,
  RESOLVED_PROMISE
} from './utils'

import { addLinks, getLink } from './crypto'
import * as types from './typeforce-types'
import { IIdentity, ITradleObject } from './types'
import Env from './env'
import Logger from './logger'

const { PREVLINK, TYPE, TYPES } = constants
const { MESSAGE } = TYPES
const { NotFound } = Errors

export default class Identities {
  private objects: any
  private pubKeys: any
  private env: Env
  private logger: Logger
  constructor (opts: { tables: any, objects: any, env: Env }) {
    logify(this)
    bindAll(this)

    const { tables, objects, env } = opts
    this.objects = objects
    this.pubKeys = tables.PubKeys
    this.env = env
    this.logger = env.sublogger('identities')
  }

  public metaByPub = (pub:string) => {
    this.logger.debug('get identity metadata by pub')
    return this.pubKeys.get({
      Key: { pub },
      ConsistentRead: true
    })
  }

  public byPub = async (pub:string):Promise<IIdentity> => {
    const { link } = await this.metaByPub(pub)
    try {
      return await this.objects.get(link)
    } catch(err) {
      this.logger.debug('unknown identity', {
        pub,
        error: err.stack
      })

      throw new NotFound('identity with pub: ' + pub)
    }
  }

  public byPermalink = async (permalink: string):Promise<IIdentity> => {
    const params = {
      IndexName: 'permalink',
      KeyConditionExpression: 'permalink = :permalinkValue',
      ExpressionAttributeValues: {
        ":permalinkValue": permalink
      }
    }

    this.logger.debug('get identity by permalink')
    const { link } = await this.pubKeys.findOne(params)
    try {
      return await this.objects.get(link)
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

  public getExistingIdentityMapping = (identity):Promise<object> => {
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

    let existing
    try {
      existing = await this.getExistingIdentityMapping(identity)
    } catch (err) {}

    const { link, permalink } = addLinks(identity)
    if (existing) {
      if (existing.link === link) {
        this.logger.debug(`mapping is already up to date for identity ${permalink}`)
      } else if (identity[PREVLINK] !== existing.link) {
        this.logger.warn('identity mapping collision. Refusing to add contact:', identity)
        throw new Error(`refusing to add identity with link: "${link}"`)
      }
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
      object = await this.objects.get(getLink(object))
    }

    const { link, permalink } = addLinks(object)
    const putPubKeys = object.pubkeys
      .map(props => this.putPubKey({ ...props, link, permalink }))

    this.logger.info('adding contact', { permalink })
    await Promise.all(putPubKeys.concat(
      this.objects.put(object)
    ))
  }

  public putPubKey = (props: { link: string, permalink: string, pub: string }):Promise<any> => {
    const { pub, link } = props
    this.logger.debug(`adding mapping"`, {
      pub,
      link
    })

    return this.pubKeys.put({
      Item: props
    })
  }

  /**
   * Add author metadata, including designated recipient, if object is a message
   * @param {String} object._sigPubKey author sigPubKey
   */
  public addAuthorInfo = async (object: ITradleObject) => {
    if (!object._sigPubKey) {
      this.objects.addMetadata(object)
    }

    const type = object[TYPE]
    const isMessage = type === MESSAGE
    const pub = isMessage && object.recipientPubKey.pub.toString('hex')
    const { author, recipient } = {
      author: await this.metaByPub(object._sigPubKey),
      recipient: await (pub ? this.metaByPub(pub) : RESOLVED_PROMISE)
    }

    setVirtual(object, { _author: author.permalink })
    if (recipient) {
      setVirtual(object, { _recipient: recipient.permalink })
    }

    return object
  }

  public addContact = async (identity:IIdentity):Promise<void> => {
    const result = await this.validateNewContact(identity)
    // debug('validated contact:', prettify(result))
    if (!result.exists) {
      await this.addContactWithoutValidating(result.identity)
    }
  }
}


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
