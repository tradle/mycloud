const debug = require('debug')('tradle:sls:identities')
import constants = require('./constants')
import Errors = require('./errors')
import {
  firstSuccess,
  logify,
  typeforce,
  omitVirtual,
  setVirtual,
  bindAll,
  RESOLVED_PROMISE
} from './utils'

import { addLinks, getLink, getLinks } from './crypto'
import * as types from './typeforce-types'
import * as Events from './events'

const { PREVLINK, PERMALINK, TYPE, TYPES } = constants
const { MESSAGE } = TYPES
const { NotFound } = Errors

export default class Identities {
  private objects: any
  private pubKeys: any
  constructor (opts: { tables: any, objects: any }) {
    logify(this)
    bindAll(this)

    const { tables, objects } = opts
    this.objects = objects
    this.pubKeys = tables.PubKeys
  }

  getIdentityMetadataByPub = pub => {
    debug('get identity metadata by pub')
    return this.pubKeys.get({
      Key: { pub },
      ConsistentRead: true
    })
  }

  getIdentityByPub = async (pub) => {
    const { link } = await this.getIdentityMetadataByPub(pub)
    try {
      return await this.objects.getObjectByLink(link)
    } catch(err) {
      debug('unknown identity', pub, err)
      throw new NotFound('identity with pub: ' + pub)
    }
  }

  getIdentityByPermalink = async (permalink: string) => {
    const params = {
      IndexName: 'permalink',
      KeyConditionExpression: 'permalink = :permalinkValue',
      ExpressionAttributeValues: {
        ":permalinkValue": permalink
      }
    }

    debug('get identity by permalink')
    const { link } = await this.pubKeys.findOne(params)
    try {
      return await this.objects.getObjectByLink(link)
    } catch(err) {
      debug('unknown identity', permalink, err)
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
//     .then(this.objects.getObjectByLink)
// }

  getExistingIdentityMapping = identity => {
    debug('checking existing mappings for pub keys')
    const lookups = identity.pubkeys.map(obj => this.getIdentityMetadataByPub(obj.pub))
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

  validateNewContact = async (identity) => {
    identity = omitVirtual(identity)

    let existing
    try {
      existing = await this.getExistingIdentityMapping(identity)
    } catch (err) {}

    const { link, permalink } = addLinks(identity)
    if (existing) {
      if (existing.link === link) {
        debug(`mapping is already up to date for identity ${permalink}`)
      } else if (identity[PREVLINK] !== existing.link) {
        debug('identity mapping collision. Refusing to add contact:', JSON.stringify(identity))
        throw new Error(`refusing to add identity with link: "${link}"`)
      }
    }

    return {
      identity: existing || identity,
      exists: !!existing
    }
  }

  addContact = async (object) => {
    if (object) {
      typeforce(types.identity, object)
    } else {
      object = await this.objects.getObjectByLink(getLink(object))
    }

    const { link, permalink } = addLinks(object)
    const putPubKeys = object.pubkeys
      .map(props => this.putPubKey({ ...props, link, permalink }))

    await Promise.all(putPubKeys.concat(
      this.objects.putObject(object)
    ))
  }

  putPubKey = (props: { link: string, permalink: string, pub: string }) => {
    const { pub, link } = props
    debug(`adding mapping from pubKey "${pub}" to link "${link}"`)
    return this.pubKeys.put({
      Item: props
    })
  }

  /**
   * Add author metadata, including designated recipient, if object is a message
   * @param {String} object._sigPubKey author sigPubKey
   */
  addAuthorInfo = async (object) => {
    if (!object._sigPubKey) {
      this.objects.addMetadata(object)
    }

    const type = object[TYPE]
    const isMessage = type === MESSAGE
    const pub = isMessage && object.recipientPubKey.pub.toString('hex')
    const promises = {
      author: await this.getIdentityMetadataByPub(object._sigPubKey),
      recipient: await (pub ? this.getIdentityMetadataByPub(pub) : RESOLVED_PROMISE)
    }

    const { author, recipient } = promises

    setVirtual(object, { _author: author.permalink })
    if (recipient) {
      setVirtual(object, { _recipient: recipient.permalink })
    }

    return object
  }

  validateAndAdd = async (identity) => {
    const result = await this.validateNewContact(identity)
    // debug('validated contact:', prettify(result))
    if (!result.exists) return this.addContact(result.identity)
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
//   getIdentityByLink: this.objects.getObjectByLink,
//   getIdentityByPermalink,
//   getIdentityByPub,
//   getIdentityMetadataByPub,
//   // getIdentityByFingerprint,
//   // createAddContactEvent,
//   addContact,
//   validateNewContact,
//   validateAndAdd,
//   addAuthorInfo
// })
