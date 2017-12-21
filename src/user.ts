// @ts-ignore
import Promise = require('bluebird')
import { pick, omitVirtual, bindAll, RESOLVED_PROMISE } from './utils'
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
import { ISession } from './types'

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
class UserSim {
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
    this.logger = logger.sub('usersim')
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

  public onSentMessages = async ({ clientId, messages }) => {
    const processed = await Promise.mapSeries(
      messages,
      message => this.onSentMessage({ clientId, message })
    )

    return processed.filter(notNull)
  }

  public onSentMessage = async ({ clientId, message }) => {
    const { TESTING } = this.env

    // if (Math.random() < 0.5) {
    //   console.log('ONSENTMESSAGE, REQUESTING RECONNECT')
    //   await this.requestIotClientReconnect({ clientId })
    //   return
    // }

    let ensureLiveSession = RESOLVED_PROMISE
    if (clientId) {
      ensureLiveSession = this.tasks.add({
        name: 'checklivesession',
        promiser: () => this.ensureLiveSession({ clientId })
      })
    }

    let err
    let processed
    try {
      processed = await this.provider.receiveMessage({ message })
    } catch (e) {
      // delivery http
      err = e
      if (!clientId) {
        Errors.ignore(err, Errors.Duplicate)
        return
      }
    }

    if (!err) {
      // SUCCESS!
      this.logger.debug('received valid message from user')

      this.tasks.add({
        name: 'delivery:ack',
        promiser: async () => {
          await ensureLiveSession
          await this.delivery.ack({
            clientId,
            message: processed
          })
        }
      })

      return processed
    }

    this.logger.debug(`processing error in receive: ${err.name}`)
    processed = err.progress
    if (err instanceof Errors.Duplicate) {
      this.logger.info('ignoring but acking duplicate message', {
        link: processed._link,
        author: processed._author
      })

      // HTTP
      if (!clientId) return

      this.tasks.add({
        name: 'delivery:ack',
        promiser: async () => {
          await ensureLiveSession
          await this.delivery.ack({
            clientId,
            message: processed
          })
        }
      })

      return
    }

    if (err instanceof Errors.TimeTravel ||
      err instanceof Errors.NotFound ||
      err instanceof Errors.InvalidSignature ||
      err instanceof Errors.InvalidMessageFormat) {
      // HTTP
      let logMsg
      if (err instanceof Errors.TimeTravel) {
        logMsg = 'rejecting message with lower timestamp than previous'
        // @ts-ignore
      } else if (err instanceof Errors.NotFound) {
        logMsg = 'rejecting message, either sender or payload identity was not found'
        // @ts-ignore
      } else if (err instanceof Errors.InvalidMessageFormat) {
        logMsg = 'rejecting message, invalid message format'
      } else {
        logMsg = 'rejecting message, invalid signature'
      }

      this.logger.warn(logMsg, {
        message: processed,
        error: err.stack
      })

      if (!clientId) {
        throw new Errors.HttpError(400, err.message)
      }

      this.tasks.add({
        name: 'delivery:reject',
        promiser: async () => {
          await ensureLiveSession
          await this.delivery.reject({
            clientId,
            message: processed,
            error: err
          })
        }
      })

      return
    }

    this.logger.error('unexpected error in pre-processing inbound message', {
      message: processed || message,
      error: err.stack
    })

    throw err
  }

  public onDisconnected = async ({ clientId }) => {
    try {
      const session = await this.auth.setConnected({ clientId, connected: false })
      this.logger.debug(`client disconnected`, session)
    } catch (error) {
      this.logger.error('failed to update presence information', error)
      await this.requestIotClientReconnect({ clientId, error })
      Errors.rethrow(error, 'system')
    }
  }

  public ensureLiveSession = async ({ clientId }) => {
    try {
      await this.auth.getMostRecentSessionByClientId(clientId)
    } catch (error) {
      Errors.ignore(error, Errors.NotFound)
      this.logger.debug('iot session not found', { clientId })
      await this.requestIotClientReconnect({ clientId, error })
    }
  }

  public onConnected = async ({ clientId }) => {
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
  return prettify(pick(session, ['connected', 'subscribed']))
}

module.exports = UserSim
