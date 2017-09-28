const debug = require('debug')('tradle:sls:friends')
import * as fetch from 'node-fetch'
import * as buildResource from '@tradle/build-resource'
import { addLinks } from './crypto'
import { Identities } from './types'

const FRIEND_TYPE = 'tradle.MyCloudFriend'

class Friends {
  private models: any;
  private model: any;
  private db: any;
  private identities: Identities;
  private provider: any;
  public addContact: Function;
  public signObject: Function;
  constructor (opts: { models, db, identities: Identities, provider }) {
    const { models, db, identities, provider } = opts
    this.models = models
    this.model = models[FRIEND_TYPE]
    this.db = db
    this.addContact = identities.addContact
    this.signObject = provider.signObject
  }

  load = async (opts: { url: string }) => {
    let { url } = opts
    url = url.replace(/[/]+$/, '')

    const infoUrl = getInfoEndpoint(url)
    const res = await fetch(infoUrl)
    if (res.status > 300) {
      throw new Error(res.statusText)
    }

    const info = await res.json()
    const {
      bot: { pub },
      org,
      publicConfig
    } = info

    const { name } = org
    await this.add({
      name,
      url,
      org,
      publicConfig,
      identity: pub
    })
  }

  add = async (props: { identity: any }) => {
    const { models, model } = this
    const { identity } = props
    addLinks(identity)

    const object = buildResource({ models, model })
      .set(props)
      .toJSON()

    const signed = await this.signObject({ object })
    buildResource.setVirtual(signed, {
      _time: Date.now(),
      _identityPermalink: buildResource.permalink(identity)
    })

    await Promise.all([
      this.addContact(identity),
      this.db.merge(signed)
    ])

    return signed
  }

  get = (opts: { permalink: string }) => {
    const { permalink } = opts
    return this.db.findOne({
      type: FRIEND_TYPE,
      filter: {
        EQ: {
          _identityPermalink: permalink
        }
      }
    })
  }

  list = (opts: { permalink: string }) => {
    const { permalink } = opts
    return this.db.find({
      type: FRIEND_TYPE,
      orderBy: {
        property: '_time',
        desc: true
      }
    })
  }
}

function getInfoEndpoint (url) {
  if (!url.endsWith('/info')) {
    url += '/info'
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

