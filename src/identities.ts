// @ts-ignore
import Promise from 'bluebird'
import clone from 'lodash/clone'
import Cache from 'lru-cache'
import constants from './constants'
import Errors from './errors'
import { firstSuccess, logify, typeforce, omitVirtual, bindAll, cachifyFunction } from './utils'

import { addLinks, getLink, getLinks, getPermalink, extractSigPubKey } from './crypto'
import * as types from './typeforce-types'
import {
  IIdentity,
  ITradleObject,
  Env,
  Logger,
  Objects,
  Storage,
  DB,
  ModelStore,
  IHasLogger,
  DBFindOpts
} from './types'

import baseModels from './models'

const { PREVLINK, AUTHOR, SIG, ORG, ORG_SIG, TYPE, TYPES, IDENTITY_KEYS_KEY } = constants
const { MESSAGE, IDENTITY } = TYPES
const { NotFound } = Errors
const CACHE_MAX_AGE = 5000
const PUB_KEY = 'tradle.PubKey'
const PUB_KEY_MODEL = baseModels[PUB_KEY]
const UPDATE_DEPENDENCIES = 'Run `npm install` to update dependencies'

interface GetPubKeyMappingOpts {
  pub: string
  time: number
}

// requirement for byPermalink query efficiency
const validatePubKeyModel = model => {
  const firstIndex = model.indexes[0]
  if (firstIndex.hashKey !== 'permalink') {
    throw new Errors.InvalidInput(
      `expected PubKey model.indexes[0].hashKey to be permalink. ${UPDATE_DEPENDENCIES}`
    )
  }

  if (!firstIndex.rangeKey.template.startsWith('{_time}')) {
    throw new Errors.InvalidInput(
      `expected PubKey model.indexes[0].rangeKey to be time-sortable. ${UPDATE_DEPENDENCIES}`
    )
  }
}

validatePubKeyModel(PUB_KEY_MODEL)

const rethrowNotFoundAsUnknownAuthor = (err, message) => {
  Errors.ignoreNotFound(err)
  throw new Errors.UnknownAuthor(message)
}

const ORDER_BY_RECENT_FIRST = {
  property: '_time',
  desc: true
}

type AuthorInfo = {
  _author: string
}

type PubKeyMapping = {
  link: string
  pub: string
}

type IdentitiesOpts = {
  db: DB
  objects: Objects
  storage: Storage
  modelStore: ModelStore
  logger: Logger
}

// this.secrets.getJSON(IDENTITY_KEYS_KEY)

export default class Identities implements IHasLogger {
  public logger: Logger
  private pubKeys: any
  private env: Env
  private get modelStore() {
    return this.components.modelStore
  }
  private get db() {
    return this.components.db
  }
  private get objects() {
    return this.components.objects
  }
  private get storage() {
    return this.components.storage
  }
  private components: IdentitiesOpts
  private _cachePub: Function
  private _cacheIdentity: Function
  private _uncachePub: Function
  private _uncacheIdentity: Function
  constructor(components: IdentitiesOpts) {
    bindAll(this)

    this.components = components

    const { logger } = components
    this.logger = logger.sub('identities')

    const getLatestCachified = cachifyFunction(
      {
        cache: new Cache({ maxAge: CACHE_MAX_AGE }),
        getPubKey: this.getLatestPubKeyMapping.bind(this),
        logger
      },
      'getPubKey'
    )

    this._cachePub = keyObj => getLatestCachified.set([keyObj.pub], normalizePub(keyObj))
    this._uncachePub = keyObj => getLatestCachified.del([keyObj.pub])

    this.getLatestPubKeyMapping = getLatestCachified.call

    const getIdentityCachified = cachifyFunction(
      {
        cache: new Cache({ maxAge: CACHE_MAX_AGE }),
        byPermalink: this.byPermalink.bind(this),
        logger
      },
      'byPermalink'
    )

    this._cacheIdentity = identity => {
      const { link, permalink } = getLinks(identity)
      getIdentityCachified.set([permalink], identity)
      getNormalizedPubKeys(identity).forEach(key => this._cachePub(key))
    }

    this._uncacheIdentity = identity => {
      const { link, permalink } = getLinks(identity)
      getIdentityCachified.del([permalink])
      getNormalizedPubKeys(identity).forEach(key => this._uncachePub(key))
    }

    this.byPermalink = getIdentityCachified.call

    logify(this, { level: 'silly', logger }, [
      'byPermalink',
      'getLatestPubKeyMapping',
      'putPubKey',
      'validateNewContact'
    ])
  }

  public getLatestPubKeyMapping = async (pub: string) => {
    // maybe should be { time: Infinity }
    // Note: we should reject items with future _time
    return this.getPubKeyMapping({
      pub,
      time: Date.now()
    })
  }

  public getPubKeyMapping = async ({ pub, time }: GetPubKeyMappingOpts) => {
    // get the PubKey that was the most recent known
    // at the "time"
    const findOpts = getPubKeyMappingQuery({ pub, time })
    if (Date.now() - time < constants.unitToMillis.minute) {
      this.logger.debug('getPubKeyMapping, using consistent read')
      findOpts.consistentRead = true
    }

    try {
      return await this.db.findOne(findOpts)
    } catch (err) {
      rethrowNotFoundAsUnknownAuthor(err, `with pubKey ${pub}`)
    }
  }

  // public getPubKey = async (pub:string) => {
  //   try {
  //     const key = await this.db.get({
  //       [TYPE]: PUB_KEY,
  //       pub
  //     })

  //     this._cachePub(key)
  //     return key
  //   } catch (err) {
  //     Errors.ignoreNotFound(err)
  //     throw new Errors.UnknownAuthor(`with pub: ${pub}`)
  //   }
  // }

  // public byPub = async (pub:string):Promise<IIdentity> => {
  //   const { link } = await this.getPubKey(pub)
  //   try {
  //     const identity = await this.objects.get(link)
  //     this._cacheIdentity(identity)
  //     return identity as IIdentity
  //   } catch(err) {
  //     Errors.ignoreNotFound(err)
  //     this.logger.debug('unknown identity', { pub })
  //     throw new Errors.UnknownAuthor('with pub: ' + pub)
  //   }
  // }

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

  public byPermalink = async (permalink: string): Promise<IIdentity> => {
    try {
      return await this._byPermalink(permalink)
    } catch (err) {
      rethrowNotFoundAsUnknownAuthor(err, `with permalink ${permalink}`)
    }
  }

  private _byPermalink = async (permalink: string): Promise<IIdentity> => {
    const table = this.db.getTableForModel(baseModels[IDENTITY])
    const { rangeKey } = table.indexes[0]
    const { link } = await this.db.findOne({
      select: ['link'],
      filter: {
        EQ: {
          [TYPE]: PUB_KEY,
          permalink
        }
      },
      orderBy: {
        property: rangeKey,
        desc: true
      }
    })

    try {
      const identity = await this.objects.get(link)
      return identity as IIdentity
    } catch (err) {
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

  public getExistingIdentityMapping = async (identity): Promise<PubKeyMapping> => {
    this.logger.debug('checking existing mappings for pub keys')

    const { pubkeys } = identity
    // optimize for common case
    try {
      return await this.getLatestPubKeyMapping(pubkeys[0].pub)
    } catch (err) {
      if (pubkeys.length === 1) throw err

      Errors.ignoreNotFound(err)
    }

    this.logger.debug('uncommon case, running more lookups')
    const lookups = pubkeys.slice(1).map(key => this.getLatestPubKeyMapping(key.pub))
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

  public validateNewContact = async identity => {
    this._ensureFresh(identity)
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
    } catch (err) {} // tslint:disable-line no-empty

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
      throw new Errors.InvalidVersion(
        `expected identity version to be signed with an 'update' key from the previous version`
      )
    }

    this._cacheIdentity(identity)
    return {
      identity: existing || identity,
      exists: !!existing
    }
  }

  public addContactWithoutValidating = async (identity: IIdentity): Promise<void> => {
    this._ensureFresh(identity)

    if (identity) {
      typeforce(types.identity, identity)
    } else {
      identity = (await this.objects.get(getLink(identity))) as IIdentity
    }

    identity = clone(identity)

    this.objects.addMetadata(identity)
    const link = identity._link
    const permalink = identity._permalink
    const putPubKeys = identity.pubkeys.map(({ type, pub, fingerprint }) =>
      this.putPubKey({
        type,
        pub,
        fingerprint,
        link,
        permalink,
        _time: identity._time
      })
    )

    this._cacheIdentity(identity)
    this.logger.info('adding contact', { permalink })
    await Promise.all(putPubKeys.concat(this.storage.save({ object: identity })))
  }

  public putPubKey = async (props: {
    type: string
    pub: string
    fingerprint: string
    link: string
    permalink: string
    _time: number
  }): Promise<any> => {
    const { pub, permalink, link, _time } = props
    this._ensureFresh(props)

    this.logger.debug('adding mapping', {
      pub,
      link
    })

    this._cachePub(props)
    return await this.db.put(normalizePub(props))
    // {
    //   ExpressionAttributeNames: {
    //     '#pub': 'pub',
    //     '#permalink': 'permalink',
    //     '#time': '_time',
    //   },
    //   ExpressionAttributeValues: {
    //     ':permalink': permalink,
    //     ':time': _time
    //   },
    //   // either pub doesn't exist or _time increased
    //   ConditionExpression: 'attribute_not_exists(#pub) OR (#permalink = :permalink AND #time >= :time)'
    // })
  }

  /**
   * calc author metadata from signing key
   * @param {String} object._sigPubKey author sigPubKey
   */
  public calcAuthorInfo = async (object: ITradleObject): Promise<AuthorInfo> => {
    const { _sigPubKey } = this.objects.getMetadata(object)
    let author
    try {
      author = await this.getPubKeyMapping({
        pub: _sigPubKey,
        time: object._time
      })
    } catch (err) {
      // UnknownAuthor.itemPermalink
      err.itemPermalink = object._permalink
      throw err
    }

    const ret = {
      _author: author.permalink
    } as AuthorInfo

    return ret
  }

  public verifyAuthor = async (object: ITradleObject): Promise<void> => {
    const author = object[AUTHOR]
    if (!author) throw new Errors.InvalidInput(`expected ${AUTHOR}`)

    const info = await this.calcAuthorInfo(object)
    if (info._author !== author) {
      throw new Errors.InvalidInput(`_sigPubKey doesn't match specified ${AUTHOR}`)
    }

    await Promise.all([this.verifyOrgAuthor(object), this.verifyMasterAuthor(object)])
  }

  public verifyOrgAuthor = async (object: ITradleObject) => {
    const org = object[ORG]
    const orgsig = object[ORG_SIG]
    const author = object[AUTHOR]
    if (!org || org === author) return
    if (!orgsig) throw new Errors.InvalidInput(`expected ${ORG_SIG}`)

    this.logger.debug('verifying org sig')
    const stripped = omitVirtual(object)
    await this.verifyAuthor({
      ...stripped,
      [SIG]: orgsig,
      [AUTHOR]: org
    })
  }

  public verifyMasterAuthor = async (object: ITradleObject) => {
    if (!object._masterAuthor) return

    const identity = await this.byPermalink(object._masterAuthor)
    const key = identity.pubkeys.find(
      ({ pub, importedFrom }) => pub === object._sigPubKey && importedFrom === object._author
    )

    if (!key) {
      throw new Errors.InvalidAuthor(
        `invalid _masterAuthor, expected master identity to have _sigPubKey ${object._sigPubKey}`
      )
    }
  }

  public addContact = async (identity: IIdentity): Promise<void> => {
    const result = await this.validateNewContact(identity)
    // debug('validated contact:', prettify(result))
    if (!result.exists) {
      await this.addContactWithoutValidating(result.identity)
    }
  }

  public delContact = async (identity: IIdentity) => {
    this._uncacheIdentity(identity)
    await Promise.map(getNormalizedPubKeys(identity), key => this.db.del(key))
  }

  public delContactWithHistory = async (identity: IIdentity) => {
    const { items } = await this.db.find({
      filter: {
        EQ: {
          [TYPE]: PUB_KEY,
          permalink: getPermalink(identity)
        }
      }
    })

    await Promise.map(items, item => this.db.del(item), {
      concurrency: 20
    })
  }

  private _ensureFresh = (obj: ITradleObject) => {
    const time = obj._time
    // warn for now
    const now = Date.now()
    if (time - constants.SIGNATURE_FRESHNESS_LEEWAY > now) {
      const type = obj[TYPE]
      const diff = now - time
      const msg = `expected past date. Current time: ${now}, ${type}._time: ${time}, diff: ${diff}ms`
      this.logger.error(msg)
      // throw new Errors.InvalidInput(msg)
    }
  }
}

export { Identities }

const isUpdateKey = key => key.type === 'ec' && key.purpose === 'update'

const normalizePub = key => {
  typeforce(
    {
      link: typeforce.String,
      permalink: typeforce.String,
      pub: typeforce.String,
      _time: typeforce.Number
    },
    key
  )

  return {
    [TYPE]: PUB_KEY,
    ...key
  }
}

const getNormalizedPubKeys = (identity: IIdentity) => {
  const { link, permalink } = getLinks(identity)
  return identity.pubkeys.map(key => ({
    ...key,
    link,
    permalink,
    _time: identity._time
  }))
}

const getPubKeyMappingQuery = ({ pub, time }): DBFindOpts => ({
  filter: {
    EQ: {
      [TYPE]: PUB_KEY,
      pub
    },
    LT: {
      _time: time
    }
  },
  orderBy: ORDER_BY_RECENT_FIRST
})
