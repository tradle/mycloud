import { TaskManager } from './task-manager'
import { getUpdateParams } from './db-utils'
import { typeforce, defineGetter } from './utils'
import { prettify } from './string-utils'
import { randomString, getPermalink } from './crypto'
import Errors from './errors'
import * as types from './typeforce-types'
import * as constants from './constants'
import {
  Tradle,
  Env,
  AwsApis,
  Logger,
  Identities,
  Messages,
  Objects,
  IDebug,
  ISession,
  IIotClientResponse,
  IRoleCredentials,
  IAuthResponse,
  IIdentity,
  ITradleObject,
  IServiceMap
} from './types'

const { HANDSHAKE_TIMEOUT } = constants
const { HandshakeFailed, InvalidInput, NotFound } = Errors

interface IChallengeResponse extends ITradleObject {
  clientId: string
  permalink: string
  challenge: string
  position: any
}

// const onExit = co(function* ({ clientId }) {
//   try {
//     await this.tables.Presence.del({
//       KeyConditionExpression: '#clientId = :clientId',
//       ExpressionAttributeNames: {
//         '#clientId': 'clientId'
//       },
//       ExpressionAttributeValues: {
//         ':clientId': clientId
//       }
//     })
//   } catch (err) {
//     this.logger.debug(`Failed to delete clientId => permalink mapping in ${Presence}`, err)
//   }
// })

// const onEnter = co(function* ({ clientId }) {
//   return publish({
//     topic: `${clientId}/handshake`,
//     payload: randomString(20),
//     qos: 1
//   })
// })

export default class Auth {
  private env: Env
  private aws: AwsApis
  private serviceMap: IServiceMap
  private tables: any
  private identities: Identities
  private objects: Objects
  private messages: Messages
  private iot: any
  private logger: Logger
  private tasks: TaskManager
  constructor (opts: {
    env: Env,
    aws: any,
    serviceMap: IServiceMap,
    tables: any,
    identities: Identities,
    objects: Objects,
    messages: Messages,
    iot: any,
    logger: Logger,
    tasks: TaskManager
  }) {
    // lazy define
    this.env = opts.env
    this.aws = opts.aws
    this.serviceMap = opts.serviceMap
    this.tables = opts.tables
    this.identities = opts.identities
    this.objects = opts.objects
    this.messages = opts.messages
    this.iot = opts.iot
    this.logger = opts.logger.sub('auth')
    this.tasks = opts.tasks
  }


  static getPermalinkFromClientId = getPermalinkFromClientId
  public getPermalinkFromClientId = getPermalinkFromClientId

  get accountId () {
    return this.env.accountId
  }

  public putSession = async (session:ISession): Promise<ISession> => {
    this.logger.debug('saving session', session)

    // allow multiple sessions for the same user?
    // await deleteSessionsByPermalink(permalink)
    return await this.tables.Presence.put({
      Item: session
    })
  }

  public setConnected = async ({ clientId, connected }): Promise<any> => {
    if (!connected) {
      return await this.updateSession({ clientId }, {
        connected: false,
        subscribed: false
      })
    }

    return await this.tables.Presence.update({
      Key: getKeyFromClientId(clientId),
      UpdateExpression: 'SET #connected = :connected, #dateConnected = :dateConnected',
      ConditionExpression: '#authenticated = :authenticated',
      ExpressionAttributeNames: {
        '#connected': 'connected',
        '#authenticated': 'authenticated',
        '#dateConnected': 'dateConnected'
      },
      ExpressionAttributeValues: {
        ':connected': true,
        ':authenticated': true,
        ':dateConnected': Date.now()
      },
      ReturnValues: 'ALL_NEW'
    })
  }

  public setSubscribed = async ({ clientId, subscribed }): Promise<any> => {
    // params.Key = getKeyFromClientId(clientId)
    if (!subscribed) {
      return await this.updateSession({ clientId }, { subscribed: false })
    }

    return await this.tables.Presence.update({
      Key: getKeyFromClientId(clientId),
      UpdateExpression: 'SET #subscribed = :subscribed, #dateSubscribed = :dateSubscribed',
      ConditionExpression: '#authenticated = :authenticated',
      ExpressionAttributeNames: {
        '#subscribed': 'subscribed',
        '#authenticated': 'authenticated',
        '#dateSubscribed': 'dateSubscribed'
      },
      ExpressionAttributeValues: {
        ':subscribed': true,
        ':authenticated': true,
        ':dateSubscribed': Date.now()
      },
      ReturnValues: 'ALL_NEW'
    })
  }

  public deleteSession = (clientId: string): Promise<any> => {
    const Key = getKeyFromClientId(clientId)
    return this.tables.Presence.del({ Key })
  }

  public deleteSessionsByPermalink = (permalink: string): Promise<any> => {
    return this.tables.Presence.del(getSessionsByPermalinkQuery)
  }

  public getSessionsByPermalink = (permalink: string): Promise<ISession[]> => {
    return this.tables.Presence.find(getSessionsByPermalinkQuery(permalink))
  }

  public getLiveSessionByPermalink = async (permalink: string): Promise<ISession> => {
    const sessions = await this.getSessionsByPermalink(permalink)
    const latest = sessions
      .filter(session => session.authenticated && session.connected)
      .sort((a, b) => {
        return a.time - b.time
      })
      .pop()

    if (!latest) {
      throw new NotFound('no authenticated sessions found')
    }

    this.logger.debug('latest authenticated session', latest)
    return latest
  }

  public getSession = (opts: { clientId: string }): Promise<any> => {
    const { clientId } = opts
    return this.tables.Presence.findOne({
      KeyConditionExpression: 'permalink = :permalink AND clientId = :clientId',
      ExpressionAttributeValues: {
        ':clientId': clientId,
        ':permalink': getPermalinkFromClientId(clientId),
        // ':authenticated': true
      }
    })
  }

  public createChallenge = () => randomString(32)

  // const sendChallenge = co(function* ({ clientId, permalink }) {
  //   const challenge = await createChallenge({ clientId, permalink })
  //   await Iot.sendChallenge({ clientId, challenge })
  // })

  public handleChallengeResponse = async (challengeResponse: IChallengeResponse)
    :Promise<ISession> => {
    // TODO: get rid of this after TypeScript migration
    try {
      typeforce({
        clientId: typeforce.String,
        permalink: typeforce.String,
        challenge: typeforce.String,
        position: types.position
      }, challengeResponse)
    } catch (err) {
      this.logger.error('received invalid input', err.stack)
      throw new InvalidInput(err.message)
    }

    const { clientId, permalink, challenge, position } = challengeResponse

    // const permalink = getPermalinkFromClientId(clientId)
    const session = await this.tables.Presence.get({
      Key: { clientId, permalink }
    })

    if (challenge !== session.challenge) {
      throw new HandshakeFailed('stored challenge does not match response')
    }

    if (permalink !== session.permalink) {
      throw new HandshakeFailed('claimed permalink changed from preauth')
    }

    if (Date.now() - session.time > HANDSHAKE_TIMEOUT) {
      throw new HandshakeFailed('handshake timed out')
    }

    // validate sig
    this.objects.addMetadata(challengeResponse)
    await this.identities.addAuthorInfo(challengeResponse)

    // console.log(`claimed: ${permalink}, actual: ${challengeResponse._author}`)
    if (challengeResponse._author !== permalink) {
      throw new HandshakeFailed('signature does not match claimed identity')
    }

    // const promiseCredentials = this.createCredentials(session)
    const getLastSent = this.messages.getLastMessageTo({ recipient: permalink, body: false })
      .then(message => this.messages.getMessageStub({ message }))
      .catch(err => {
        if (Errors.isNotFound(err)) return null

        throw err
      })

    Object.assign(session, {
      clientPosition: position,
      serverPosition: {
        sent: await getLastSent
      },
      authenticated: true,
      dateAuthenticated: Date.now()
    })

    this.tasks.add({
      name: 'savesession',
      promise: this.putSession(session)
    })

    return session
  }

  public createCredentials = async (session:ISession, role:string):Promise<IRoleCredentials> => {
    const { clientId } = session
    if (!role.startsWith('arn:')) {
      role = `arn:aws:iam::${this.accountId}:role/${role}`
    }

    this.logger.debug(`generating temp keys for client ${clientId}, role ${role}`)
    this.logger.info('assuming role', role)
    const params:AWS.STS.AssumeRoleRequest = {
      RoleArn: role,
      RoleSessionName: randomString(16),
      DurationSeconds: 3600
    }

    // assume role returns temporary keys
    const promiseRole = this.aws.sts.assumeRole(params).promise()
    const {
      AssumedRoleUser,
      Credentials
    } = await promiseRole

    this.logger.debug('assumed role', role)
    return {
      accessKey: Credentials.AccessKeyId,
      secretKey: Credentials.SecretAccessKey,
      sessionToken: Credentials.SessionToken,
      uploadPrefix: this.getUploadPrefix(AssumedRoleUser)
    }
  }

  public createSession = async (opts: {
    clientId: string,
    identity: IIdentity,
    ips?: string[]
  }): Promise<IIotClientResponse> => {
    try {
      typeforce({
        clientId: typeforce.String,
        identity: types.identity
      }, opts)
    } catch (err) {
      this.logger.error('received invalid input', { input: opts, stack: err.stack })
      throw new InvalidInput(err.message)
    }

    const { clientId, identity } = opts
    const permalink = getPermalink(identity)
    if (permalink !== getPermalinkFromClientId(clientId)) {
      throw new InvalidInput('expected "clientId" to have format {permalink}{nonce}')
    }

    const maybeAddContact = this.identities.addContact(identity)
    const challenge = this.createChallenge()
    const getIotEndpoint = this.iot.getEndpoint()
    const saveSession = this.tables.Presence.put({
      Item: {
        clientId,
        permalink,
        challenge,
        time: Date.now(),
        authenticated: false,
        connected: false
      }
    })

    await Promise.all([
      saveSession,
      maybeAddContact
    ])

    const resp:IIotClientResponse = {
      iotEndpoint: await getIotEndpoint,
      iotParentTopic: this.env.IOT_PARENT_TOPIC,
      region: this.env.AWS_REGION,
      time: Date.now(),
      challenge
    }

    if (this.env.IS_OFFLINE) {
      resp.s3Endpoint = this.aws.s3.endpoint.host
    }

    return resp
  }

  public getUploadPrefix = (AssumedRoleUser: {
    AssumedRoleId: string
  }):string => {
    return `${this.serviceMap.Bucket.FileUpload}/${AssumedRoleUser.AssumedRoleId}/`
  }

  public getMostRecentSessionByClientId = (clientId): Promise<any> => {
    return this.getLiveSessionByPermalink(getPermalinkFromClientId(clientId))
  }

  private updateSession = async ({ clientId }, update):Promise<ISession> => {
    return await this.tables.Presence.update({
      ...getUpdateParams(update),
      Key: getKeyFromClientId(clientId),
      ReturnValues: 'ALL_NEW'
    })
  }
}

export { Auth }
// const isMostRecentSession = co(function* ({ clientId }) {
//   try {
//     const session = await getLiveSessionByPermalink(getPermalinkFromClientId(clientId))
//     return session.clientId === clientId
//   } catch (err) {}
// })

function getKeyFromClientId (clientId) {
  return {
    clientId,
    permalink: getPermalinkFromClientId(clientId)
  }
}

function getPermalinkFromClientId (clientId:string):string {
  return clientId.slice(0, 64)
}

function getSessionsByPermalinkQuery (permalink) {
  return {
    KeyConditionExpression: 'permalink = :permalink AND begins_with(clientId, :permalink)',
    ExpressionAttributeValues: {
      ':permalink': permalink
    }
  }
}

// module.exports = {
//   // onEnter,
//   // onExit,
//   createChallenge,
//   // sendChallenge,
//   handleChallengeResponse,
//   getTemporaryIdentity,
//   getSession,
//   getSessionsByPermalink,
//   getLiveSessionByPermalink,
//   getMostRecentSessionByClientId,
//   deleteSession,
//   updatePresence
//   // isMostRecentSession
// }
