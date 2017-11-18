
import superagent = require('superagent')
import { protocol } from '@tradle/engine'
import buildResource = require('@tradle/build-resource')
import { ECKey, sha256, randomString } from './crypto'
import { cachifyPromiser, post } from './utils'
import Logger from './logger'
import Provider from './provider'
import KeyValueTable from './key-value-table'
import { ignore, rethrow } from './errors'
import { IIdentity } from './types'

export type Subscriber = {
  seq: number
}

export const getChallenge = ({ nonce, salt }: {
  nonce:string,
  salt:string
}) => sha256(nonce + salt)

export const getNotificationData = ({ nonce, seq }: {
  nonce: string,
  seq: number
}):string => sha256(seq + nonce)

export const createSubscriberInfo = () => ({ seq: -1 })

export default class Push {
  private logger: Logger
  private serverUrl: string
  private registration: KeyValueTable
  private subscribers: KeyValueTable
  constructor ({ serverUrl, conf, logger }:{
    serverUrl:string
    conf:KeyValueTable
    logger:Logger
  }) {
    const pushConf = conf.sub(':push')
    this.registration = pushConf.sub(':reg')
    this.subscribers = pushConf.sub(':sub')
    this.serverUrl = serverUrl
  }

  public ensureRegistered = cachifyPromiser(async ({ identity, key }) => {
    const registered = await this.isRegistered()
    if (!registered) await this.register({ identity, key })
  })

  public isRegistered = () =>
    this.registration.exists(this.serverUrl)

  public setRegistered = async ():Promise<void> => {
    await this.registration.put(this.serverUrl, {
      dateRegistered: Date.now()
    })
  }

  public register = async ({ identity, key }: {
    identity: IIdentity,
    key: ECKey
  }) => {
    const nonce = await post(`${this.serverUrl}/publisher`, {
      identity,
      key: key.toJSON()
    })

    const salt = randomString(32, 'base64')
    const sig = await key.promiseSign(getChallenge({ nonce, salt }))
    await post(`${this.serverUrl}/publisher`, { nonce, salt, sig })
    await this.setRegistered()
  }

  public getSubscriber = async (subscriber:string):Promise<Subscriber> => {
    try {
      return await this.subscribers.get(subscriber)
    } catch (err) {
      ignore(err, {
        name: 'NotFound'
      })

      return createSubscriberInfo()
    }
  }

  public incrementSubscriberNotificationCount = async (subscriber:string)
    :Promise<Subscriber> => {
    try {
      return await this.subscribers.update(subscriber, {
        UpdateExpression: 'ADD #value.#seq :incr',
        ExpressionAttributeNames: {
          '#value': 'value',
          '#seq': 'seq'
        },
        ExpressionAttributeValues: {
          ':incr': 1
        },
        ReturnValues: 'ALL_NEW'
      })
    } catch (err) {
      rethrow(err, 'system')
      const info = createSubscriberInfo()
      info.seq++
      await this.subscribers.put(subscriber, info)
      return info
    }
  }

  public push = async ({ identity, key, subscriber }) => {
    await this.ensureRegistered({ identity, key })
    const info = await this.incrementSubscriberNotificationCount(subscriber)
    const { seq } = info
    const nonce = randomString(8, 'base64')
    const sig = await key.promiseSign(getNotificationData({ seq, nonce }))
    const publisher = buildResource.permalink(identity)
    await post(`${this.serverUrl}/notification`, {
      publisher,
      subscriber,
      seq,
      nonce,
      sig
    })
  }
}
