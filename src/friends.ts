import _ from 'lodash'
import lexint from 'lexicographic-integer'
import Cache from 'lru-cache'
import fetch from 'node-fetch'
import { TYPE, PERMALINK, PREVLINK } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { addLinks } from './crypto'
import { get, cachifyFunction, parseStub } from './utils'
import {
  Identities,
  Identity,
  Tradle,
  Logger,
  ILoadFriendOpts,
  Provider,
  DB,
  Model,
  Models,
  Objects
} from './types'

import models from './models'
import Errors from './errors'

const definitions = require('./definitions')
const tableDef = definitions.FriendsTable
// const timeIsString = tableDef.Properties.AttributeDefinitions.find(({ AttributeName }) => {
//   return AttributeName === '_time'
// }).AttributeType === 'S'

const FRIEND_TYPE = "tradle.MyCloudFriend"
const model = models[FRIEND_TYPE]
const TEN_MINUTES = 10 * 60 * 60000
const createCache = () => new Cache({ max: 100, maxAge: TEN_MINUTES })

type FriendsOpts = {
  provider: Provider
  identity: Identity
  identities: Identities
  objects: Objects
  db: DB
  logger: Logger
}

export default class Friends {
  public cache: any
  public logger: Logger
  // lazy
  private get db() { return this.components.db }
  private get identities() { return this.components.identities }
  private get identity() { return this.components.identity }
  private get provider() { return this.components.provider }
  private get objects() { return this.components.objects }
  private components: FriendsOpts
  private _clearCacheForPermalink: (permalink: string) => void
  constructor(components: FriendsOpts) {
    this.components = components

    const { logger } = components
    this.cache = createCache()
    this.logger = logger

    const { call, del } = cachifyFunction(this, 'getByIdentityPermalink')
    this.getByIdentityPermalink = call
    this._clearCacheForPermalink = del
  }

  public load = async (opts: ILoadFriendOpts): Promise<any> => {
    let { url } = opts
    if (!url) throw new Errors.InvalidInput(`expected "url" of friend's MyCloud`)

    url = url.replace(/[/]+$/, "")

    this.logger.debug('loading friend', opts)

    const infoUrl = getInfoEndpoint(url)
    const info = await get(infoUrl)
    const { bot: { pub }, org } = info

    const { name, domain } = org
    if (opts.domain && domain !== opts.domain) {
      throw new Errors.InvalidInput(`expected domain "${opts.domain}", got ${domain}`)
    }

    return await this.add({
      name,
      url,
      domain,
      org,
      identity: pub
    })
  }

  public add = async (props: {
    name: string
    domain: string
    url: string
    org: any
    identity: any
  }): Promise<any> => {
    const { name, domain, identity, org } = props
    addLinks(identity)

    const myIdentity = await this.identity.getPublic()
    if (myIdentity._permalink === identity._permalink ||
      myIdentity._link === identity._link) {
      throw new Error('refusing to add self as friend')
    }

    let existing
    try {
      existing = await this.getByIdentityPermalink(identity._permalink)
    } catch (err) {
      existing = {}
    }

    const keys = Object.keys(model.properties)
    const object = buildResource({ models, model })
      .set({
        ..._.pick(existing, keys),
        ..._.pick(props, keys)
      })
      .toJSON()

    const isSame = Object.keys(object).every(prop => {
      return _.isEqual(object[prop], existing[prop])
    })

    if (org) await this.provider.saveObject({ object: org })

    if (isSame) {
      // this.cache.set(identity._permalink, existing)
      this.logger.debug('already have friend', object)
      return existing
    }

    this.logger.debug('adding friend', object)
    if (Object.keys(existing).length) {
      object[PREVLINK] = buildResource.link(existing)
      object[PERMALINK] = buildResource.permalink(existing)
    }

    const promiseAddContact = this.identities.addContact(identity)
    const signed = await this.identity.sign({ object })
    await Promise.all([
      promiseAddContact,
      this.provider.saveObject({ object: signed })
    ])

    // await this.db.update(signed, {
    //   ConditionExpression: `attribute_not_exists(#domain) OR #identityPermalink = :identityPermalink`,
    //   ExpressionAttributeNames: {
    //     '#domain': 'domain',
    //     '#identityPermalink': '_identityPermalink'
    //   },
    //   ExpressionAttributeValues: {
    //     ':identityPermalink': permalink
    //   }
    // })

    // await this.objects.put(signed)

    // debug(`sending self introduction to friend "${name}"`)
    // await this.provider.sendMessage({
    //   recipient: permalink,
    //   object: buildResource({
    //       models,
    //       model: 'tradle.SelfIntroduction',
    //     })
    //     .set({
    //       identity: await promiseMyIdentity
    //     })
    //     .toJSON()
    // })

    // this.cache.set(identity._permalink, signed)
    return signed
  }

  public getByDomain = async (domain:string) => {
    return await this.db.findOne({
      filter: {
        EQ: {
          [TYPE]: FRIEND_TYPE,
          domain
        }
      }
    })
  }

  public getByIdentityPermalink = async (permalink:string) => {
    return await this.db.findOne({
      filter: {
        EQ: {
          [TYPE]: FRIEND_TYPE,
          'identity._permalink': permalink
        }
      }
    })
  };

  public list = async () => {
    return await this.db.find({
      filter: {
        EQ: {
          [TYPE]: FRIEND_TYPE
        }
      }
    })
  }

  public removeByIdentityPermalink = async (permalink:string) => {
    try {
      const friend = await this.getByIdentityPermalink(permalink)
      await this.del(friend)
    } catch (err) {
      Errors.ignoreNotFound(err)
    }
  }

  public removeByDomain = async (domain:string) => {
    try {
      const friend = await this.getByDomain(domain)
      await this.del(friend)
    } catch (err) {
      Errors.ignoreNotFound(err)
    }
  }

  private del = async (friend) => {
    this._clearCacheForPermalink(parseStub(friend.identity).permalink)
    // this.cache.del(parseStub(friend.identity).permalink)
    await this.db.del(friend)
  }
}

export { Friends }

function getInfoEndpoint(url) {
  if (!url.endsWith("/info")) {
    url += "/info"
  }

  return url
}

// function get ({ permalink }) {
//   return db.latest({
//     [TYPE]: FRIEND_TYPE,
//     _permalink
//   })
// }

// (async function () {
//   await load({
//     name: 'Tradle',
//     url: 'https://7hixz15a6k.execute-api.us-east-1.amazonaws.com/dev/tradle'
//   })
// }())
// .catch(console.error)
