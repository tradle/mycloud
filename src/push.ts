
import superagent from 'superagent'
import Cache from 'lru-cache'
import { protocol } from '@tradle/engine'
import buildResource from '@tradle/build-resource'
import { sha256, randomString } from './crypto'
import { cachifyFunction, post, omitVirtual } from './utils'
import Errors from './errors'
import { IIdentity, IWrappedKey, IKeyValueStore, Logger } from './types'

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

export const createSubscriberInfo = () => ({ seq: 0 })

export default class Push {
  private serverUrl: string
  private registration: IKeyValueStore
  private subscribers: IKeyValueStore
  public cache: any
  public logger: Logger
  constructor ({ serverUrl, conf, logger }:{
    serverUrl:string
    conf: IKeyValueStore
    logger:Logger
  }) {
    this.registration = conf.sub(':reg')
    this.subscribers = conf.sub(':sub')
    this.serverUrl = serverUrl
    this.cache = new Cache({ max: 1 })
    this.logger = logger
    this.ensureRegistered = cachifyFunction(this, 'ensureRegistered').call
  }

  public ensureRegistered = async ({ identity, key }) => {
    const registered = await this.isRegistered()
    if (!registered) await this.register({ identity, key })
  }

  public isRegistered = () => this.registration.exists(this.serverUrl)

  public setRegistered = async ():Promise<void> => {
    await this.registration.put(this.serverUrl, {
      dateRegistered: Date.now()
    })
  }

  public register = async ({ identity, key }: {
    identity: IIdentity,
    key: IWrappedKey
  }) => {
    const nonce = await post(`${this.serverUrl}/publisher`, {
      identity: omitVirtual(identity),
      key: key.toJSON(false)
    })

    const salt = randomString(32, 'base64')
    const sig = key.signSync(getChallenge({ nonce, salt }))
    await post(`${this.serverUrl}/publisher`, { nonce, salt, sig })
    await this.setRegistered()
  }

  public getSubscriber = async (subscriber:string):Promise<Subscriber> => {
    try {
      return await this.subscribers.get(subscriber)
    } catch (err) {
      Errors.ignoreNotFound(err)
      return createSubscriberInfo()
    }
  }

  public incrementSubscriberNotificationCount = async (subscriber:string)
    :Promise<Subscriber> => {
    return await this.subscribers.update(subscriber, {
      UpdateExpression: 'ADD #seq :incr',
      ExpressionAttributeNames: {
        '#seq': 'seq'
      },
      ExpressionAttributeValues: {
        ':incr': 1
      },
      ReturnValues: 'ALL_NEW'
    })
  }

  public saveError = async ({ error, subscriber }: {
    error: Error
    subscriber: string
  }) => {
    // TBD: whether to save last X err messages/stacks
    return await this.subscribers.update(subscriber, {
      UpdateExpression: 'ADD #errorCount :incr',
      ExpressionAttributeNames: {
        '#errorCount': 'errorCount'
      },
      ExpressionAttributeValues: {
        ':incr': 1
      },
      ReturnValues: 'ALL_NEW'
    })
  }

  public push = async ({ identity, key, subscriber }: {
    identity: IIdentity
    key: IWrappedKey
    subscriber: string
  }) => {
    await this.ensureRegistered({ identity, key })
    const info = await this.incrementSubscriberNotificationCount(subscriber)
    const seq = info.seq - 1
    const nonce = randomString(8, 'base64')
    const sig = key.signSync(getNotificationData({ seq, nonce }))
    const publisher = buildResource.permalink(identity)
    try {
      await post(`${this.serverUrl}/notification`, {
        publisher,
        subscriber,
        seq,
        nonce,
        sig
      })
    } catch (error) {
      await this.saveError({ subscriber, error })
      throw error
    }
  }
}

export { Push }
