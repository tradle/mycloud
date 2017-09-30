const debug = require("debug")("tradle:sls:friends")
import * as fetch from "node-fetch"
import * as buildResource from "@tradle/build-resource"
import { addLinks } from "./crypto"
import { Identities } from "./types"

const FRIEND_TYPE = "tradle.MyCloudFriend"

class Friends {
  private models: any
  private model: any
  private db: any
  private identities: Identities
  private provider: any
  constructor(opts: { models; db; identities: Identities; provider }) {
    const { models, db, identities, provider } = opts
    this.models = models
    this.model = models[FRIEND_TYPE]
    this.db = db
    this.identities = identities
    this.provider = provider
  }

  public load = async (opts: { url: string }): Promise<void> => {
    let { url } = opts
    url = url.replace(/[/]+$/, "")

    const infoUrl = getInfoEndpoint(url)
    const res = await fetch(infoUrl)
    if (res.status > 300) {
      throw new Error(res.statusText)
    }

    const info = await res.json()
    const { bot: { pub }, org, publicConfig } = info

    const { name } = org
    await this.add({
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

    const object = buildResource({ models, model })
      .set(props)
      .toJSON()

    const myIdentity = yield this.provider.getMyPublicIdentity()
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

    const saveFriend = this.db.merge(signed)
    debug(`saving friend: ${name}`)

    await Promise.all([promiseAddContact, saveFriend])

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

    return signed
  }

  public get = (opts: { permalink: string }) => {
    const { permalink } = opts
    return this.db.findOne({
      type: FRIEND_TYPE,
      filter: {
        EQ: {
          _identityPermalink: permalink
        }
      }
    })
  };

  public list = (opts: { permalink: string }) => {
    const { permalink } = opts
    return this.db.find({
      type: FRIEND_TYPE,
      orderBy: {
        property: "_time",
        desc: true
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

export = Friends
