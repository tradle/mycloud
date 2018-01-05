import _ = require('lodash')
// @ts-ignore
import Promise = require('bluebird')
import { omitVirtual, bindAll, RESOLVED_PROMISE } from './utils'
import { prettify } from './string-utils'
import { PUBLIC_CONF_BUCKET, SEQ } from './constants'
import Errors = require('./errors')
import types = require('./typeforce-types')
import Env from './env'
import Logger from './logger'
import Auth from './auth'
import Provider from './provider'
import Delivery from './delivery'
import { TaskManager } from './task-manager'
import Messages from './messages'
import Tradle from './tradle'
import { ISession, IPositionPair } from './types'

const notNull = val => !!val
const ClientErrors = {
  reconnect_required: 'reconnect_required',
  incompatible_client: 'incompatible_client'
}

/**
 * simulates user actions, e.g.
 *  a user sending us a message
 *  a user subscribing to a topic
 *  a user calling his grandma on her birthday
 */
export default class User {
  private env: Env
  private logger: Logger
  private auth: Auth
  private iot: any
  private provider: Provider
  private delivery: Delivery
  private buckets: any
  private messages: Messages
  private lambdaUtils: any
  private tasks: TaskManager
  constructor (tradle:Tradle) {
    const {
      env,
      logger,
      auth,
      iot,
      provider,
      delivery,
      buckets,
      messages,
      lambdaUtils,
      tasks
    } = tradle

    this.env = env
    this.logger = logger.sub('user')
    this.auth = auth
    this.iot = iot
    this.provider = provider
    this.delivery = delivery
    this.buckets = buckets
    this.messages = messages
    this.lambdaUtils = lambdaUtils
    this.tasks = tasks
  }

  public onSubscribed = async ({ clientId, topics }) => {
    this.logger.debug('client subscribed to topics:', topics.join(', '))
    // await onEnter({ clientId })

    // if (Math.random() < 0.5) {
    //   console.log('ONSUBSCRIBED, REQUESTING RECONNECT')
    //   await this.requestIotClientReconnect({ clientId })
    //   return
    // }

    if (!this.delivery.mqtt.includesClientMessagesTopic({ clientId, topics })) {
      this.logger.debug('message topic not found in topics array')
      return
    }

    let session:ISession
    try {
      session = await this.auth.setSubscribed({ clientId, subscribed: true })
      this.logger.debug(`client subscribed`, session)
    } catch (error) {
      this.logger.error('failed to update presence information', error)
      await this.requestIotClientReconnect({ clientId, error })
      Errors.rethrow(error, 'system')
      return
    }

    await this.maybeDeliverMessagesToClient(session)
  }

  public onAnnouncePosition = async ({
    clientId,
    session,
    position
  }: {
    clientId?:string,
    session?:ISession,
    position: IPositionPair
  }) => {
    if (!session) session = await this.ensureLiveSession({ clientId })

    const { clientPosition} = session
    if (!clientPosition) {
      this.logger.error('expected session to have clientPosition', { session })
      await this.requestIotClientReconnect({ clientId })
      return
    }

    const { received=clientPosition.received } = position
    if (received.time < clientPosition.received.time) {
      const message = 'position requested cannot be less than advertised during auth'
      this.logger.error(message, { session, position })
      await this.requestIotClientReconnect({ clientId, message })
      return
    }

    await this.maybeDeliverMessagesToClient({
      ...session,
      clientPosition: {
        ...clientPosition,
        received
      }
    })
  }

  public maybeDeliverMessagesToClient = async (session:ISession) => {
    if (!(session.connected && session.authenticated)) {
      this.logger.debug(`can't deliver messages, client is, ${getDeliveryReadiness(session)}`)
      return
    }

    const { clientId, permalink, clientPosition, serverPosition } = session
    const after = (clientPosition.received && clientPosition.received.time) || 0
    this.logger.debug(`delivering messages after time ${after}`)
    try {
      await this.delivery.deliverMessages({
        session,
        recipient: permalink,
        range: { after }
      })
    } catch (error) {
      this.logger.error('live delivery failed', error)
      await this.requestIotClientReconnect({ clientId, error })
      Errors.rethrow(error, 'system')
    }
  }

  public onSentMessages = async ({ clientId, messages }: {
    clientId?:string,
    messages:any[]
  }) => {
    const processed = await Promise.mapSeries(
      messages,
      message => this.onSentMessage({ clientId, message })
    )

    return processed.filter(notNull)
  }

  public onSentMessage = async ({ clientId, message }: {
    clientId?:string,
    message:any
  }) => {
    const { TESTING } = this.env

    // if (Math.random() < 0.5) {
    //   console.log('ONSENTMESSAGE, REQUESTING RECONNECT')
    //   await this.requestIotClientReconnect({ clientId })
    //   return
    // }

    // let ensureLiveSession = RESOLVED_PROMISE
    // if (clientId) {
    //   ensureLiveSession = this.tasks.add({
    //     name: 'checklivesession',
    //     promiser: () => this.ensureLiveSession({ clientId })
    //   })
    // }

    return await this.provider.receiveMessage({ clientId, message })
  }

  public onDisconnected = async ({ clientId }):Promise<ISession|void> => {
    try {
      const session = await this.auth.setConnected({ clientId, connected: false })
      this.logger.debug(`client disconnected`, session)
      return session
    } catch (error) {
      this.logger.error('failed to update presence information', error)
      await this.requestIotClientReconnect({ clientId, error })
      Errors.rethrow(error, 'system')
    }
  }

  public ensureLiveSession = async ({ clientId }):Promise<ISession|void> => {
    try {
      return await this.auth.getMostRecentSessionByClientId(clientId)
    } catch (error) {
      Errors.ignore(error, Errors.NotFound)
      this.logger.debug('iot session not found', { clientId })
      await this.requestIotClientReconnect({ clientId, error })
    }
  }

  public onConnected = async ({ clientId }):Promise<ISession|void> => {
    // if (Math.random() < 0.5) {
    //   console.log('ONCONNECTED, REQUESTING RECONNECT')
    //   await this.requestIotClientReconnect({ clientId })
    //   return
    // }

    let session
    try {
      session = await this.auth.setConnected({ clientId, connected: true })
      this.logger.debug(`client connected`, session)
    } catch (error) {
      this.logger.error('failed to update presence information', error)
      await this.requestIotClientReconnect({ clientId, error })
      Errors.rethrow(error, 'system')
      return
    }

    await this.maybeDeliverMessagesToClient(session)
    return session
  }

  public onIncompatibleClient = async ({ clientId }) => {
    await this.sendError({ clientId, message: ClientErrors.incompatible_client })
  }

  public sendError = async ({ clientId, message }) => {
    await this.delivery.mqtt.trigger({
      clientId,
      topic: 'error',
      payload: {
        message
      }
    })
  }

  public requestIotClientReconnect = async ({
    clientId,
    error,
    message=ClientErrors.reconnect_required
  }: {
    clientId: string,
    error?: Error,
    message?: string
  }) => {
    this.logger.debug('requesting iot client reconnect', error && {
      stack: error.stack
    })

    await this.sendError({ clientId, message })
  }

  // public onRestoreRequest = async ({ clientId, gt, lt }) => {
 //   let session
  //   try {
  //     session = await this.auth.getMostRecentSessionByClientId(clientId)
  //   } catch (err) {}

  //   if (!session) {
  //     this.debug(`ignoring "restore" request from outdated session: ${clientId}`)
  //     return
  //   }

  //   await this.delivery.deliverMessages({
  //     clientId: session.clientId,
  //     recipient: session.permalink,
  //     gt,
  //     lt
  //   })
  // })

  public getProviderIdentity = async () => {
    const { object } = await this.buckets.PublicConf.getJSON(PUBLIC_CONF_BUCKET.identity)
    return omitVirtual(object)
  }
}

const getDeliveryReadiness = session => {
  return prettify(_.pick(session, ['connected', 'subscribed']))
}
