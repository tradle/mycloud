const debug = require("debug")("tradle:sls:friends")
import Cache = require('lru-cache')
import fetch = require('node-fetch')
import { TYPE, PERMALINK, PREVLINK } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import { addLinks } from './crypto'
import { pick, get, cachifyFunction } from './utils'
import Identities from './identities'
import Tradle from './tradle'
import Logger from './logger'

const FRIEND_TYPE = "tradle.MyCloudFriend"
const TEN_MINUTES = 10 * 60 * 60000
const createCache = () => new Cache({ max: 100, maxAge: TEN_MINUTES })

export default class Friends {
  public models: any
  public model: any
  public db: any
  public identities: Identities
  public provider: any
  public cache: any
  public logger: Logger
  constructor(tradle:Tradle) {
    const { models, db, identities, provider, logger } = tradle
    this.models = models
    this.model = models[FRIEND_TYPE]
    this.db = db
    this.identities = identities
    this.provider = provider
    this.cache = createCache()
    this.logger = logger.sub('friends')
    this.getByIdentityPermalink = cachifyFunction(this, 'getByIdentityPermalink')
  }

  public load = async (opts: { url: string }): Promise<any> => {
    let { url } = opts
    url = url.replace(/[/]+$/, "")

    const infoUrl = getInfoEndpoint(url)
    const info = await get(infoUrl)
    const { bot: { pub }, org, publicConfig } = info

    const { name } = org
    return await this.add({
      name,
      url,
      org,
      publicConfig,
      identity: pub
    })
  }

  public add = async (props: {
    name: string
    url: string
    org: any
    publicConfig: any
    identity: any
  }): Promise<any> => {
    const { models, model } = this
    const { name, identity } = props
    addLinks(identity)

    let existing
    try {
      existing = await this.getByIdentityPermalink(identity._permalink)
    } catch (err) {
      existing = {}
    }

    const object = buildResource({ models, model })
      .set({
        ...pick(existing, Object.keys(model.properties)),
        ...props,
        _identityPermalink: identity._permalink
      })
      .toJSON()

    if (Object.keys(existing).length) {
      object[PREVLINK] = buildResource.link(existing)
      object[PERMALINK] = buildResource.permalink(existing)
    }

    const myIdentity = await this.provider.getMyPublicIdentity()
    if (myIdentity._permalink === identity._permalink ||
      myIdentity._link === identity._link) {
      throw new Error('refusing to add self as friend')
    }

    const promiseAddContact = this.identities.addContact(identity)
    const signed = await this.provider.signObject({ object })
    const permalink = buildResource.permalink(identity)
    buildResource.setVirtual(signed, {
      _time: Date.now(),
      _identityPermalink: permalink
    })

    await promiseAddContact
    debug(`saving friend: ${name}`)
    await this.db.update(signed)

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

    this.cache.set(identity._permalink, signed)
    return signed
  }

  public getByIdentityPermalink = async (permalink:string) => {
    return await this.db.get({
      [TYPE]: FRIEND_TYPE,
      _identityPermalink: permalink
    })
  };

  public list = (opts: { permalink: string }) => {
    const { permalink } = opts
    return this.db.find({
      filter: {
        EQ: {
          [TYPE]: FRIEND_TYPE
        }
      }
    })
  }
}

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
