// @ts-ignore
import Promise from 'bluebird'
import merge from 'lodash/merge'
import clamp from 'lodash/clamp'
import { TYPE } from '@tradle/constants'
import { TaskManager } from './task-manager'
import { typeforce, ensureNoVirtualProps, pickNonNull } from './utils'
import { isHex } from './string-utils'
import { randomString, getPermalink } from './crypto'
import Errors from './errors'
import * as types from './typeforce-types'
import * as constants from './constants'
import {
  AwsApis,
  Logger,
  Identities,
  Messages,
  Objects,
  ISession,
  IIotClientChallenge,
  IRoleCredentials,
  IIdentity,
  ITradleObject,
  Iot,
  DB,
  ModelStore,
} from './types'

const { HANDSHAKE_TIMEOUT } = constants
const SESSION = 'tradle.IotSession'

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

type AuthOpts = {
  uploadFolder: string
  aws: any
  // tables: any
  identities: Identities
  objects: Objects
  messages: Messages
  db: DB
  iot: Iot
  logger: Logger
  tasks: TaskManager
  modelStore: ModelStore
  sessionTTL?: number
}

export default class Auth {
  private aws: AwsApis
  // private tables: any
  private identities: Identities
  private objects: Objects
  private messages: Messages
  private db: DB
  private iot: Iot
  private logger: Logger
  private tasks: TaskManager
  private modelStore: ModelStore
  private uploadFolder: string
  private sessionTTL: number

  constructor (opts: AuthOpts) {
    // lazy define
    this.aws = opts.aws
    // this.tables = opts.tables
    this.identities = opts.identities
    this.objects = opts.objects
    this.messages = opts.messages
    this.db = opts.db
    this.iot = opts.iot
    this.logger = opts.logger.sub('auth')
    this.tasks = opts.tasks
    this.modelStore = opts.modelStore
    this.uploadFolder = opts.uploadFolder
    const { sessionTTL=constants.DEFAULT_SESSION_TTL_SECONDS } = opts
    this.sessionTTL = clamp(sessionTTL, constants.MIN_SESSION_TTL_SECONDS, constants.MAX_SESSION_TTL_SECONDS)
  }

  public putSession = async (session:ISession): Promise<ISession> => {
    this.logger.debug('saving session', session)

    // allow multiple sessions for the same user?
    // await deleteSessionsByPermalink(permalink)
    // return await this.tables.Presence.put({
    //   Item: session
    // })
    await this.db.put(session)
    return session
  }

  public setSubscribed = async ({ clientId, subscribed }): Promise<any> => {
    // params.Key = this.getKeyFromClientId(clientId)
    if (!subscribed) {
      return await this.updateSession(clientId, { subscribed: false, connected: false })
    }

    return await this.updateSession(clientId, {
      subscribed: true,
      connected: true,
      dateSubscribed: Date.now()
    }, {
      expected: { authenticated: true } ,
      ReturnValues: 'ALL_NEW'
    })
  }

  public deleteSession = (clientId: string): Promise<any> => {
    return this.db.del(this.getKeyFromClientId(clientId))
  }

  // public getSessionsByPermalink = async (permalink: string): Promise<ISession[]> => {
  //   const { items } = await this.db.find({
  //     filter: {
  //       EQ: {
  //         [TYPE]: SESSION,
  //         permalink
  //       }
  //     }
  //   })

  //   return items
  // }

  public getLiveSessionByPermalink = async (permalink: string): Promise<ISession> => {
    const latest = await this.db.findOne({
      allowScan: true,
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: SESSION,
          permalink,
          authenticated: true,
          connected: true,
          subscribed: true,
        },
        STARTS_WITH: {
          clientId: (this.iot && this.iot.clientIdPrefix || '') + permalink
        },
      }
    })

    this.logger.debug('latest authenticated session', { user: permalink, dateConnected: latest.dateConnected })
    return latest
  }

  public getSession = async (opts: { clientId: string }): Promise<any> => {
    return await this.db.get(this.getKeyFromClientId(opts.clientId))
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
      // @ts-ignore
      debugger
      this.logger.error('received invalid input', err.stack)
      Errors.rethrowAs(err, new Errors.InvalidInput(err.message))
    }

    const { clientId, permalink, challenge, position } = challengeResponse

    // const permalink = this.getPermalinkFromClientId(clientId)
    const session = await this.getSession({ clientId })

    if (challenge !== session.challenge) {
      throw new Errors.HandshakeFailed('stored challenge does not match response')
    }

    if (permalink !== session.permalink) {
      throw new Errors.HandshakeFailed('claimed permalink changed from preauth')
    }

    if (Date.now() - session._time > HANDSHAKE_TIMEOUT) {
      throw new Errors.HandshakeFailed('handshake timed out')
    }

    // validate sig
    this.objects.addMetadata(challengeResponse)
    await this.identities.verifyAuthor(challengeResponse)

    // console.log(`claimed: ${permalink}, actual: ${challengeResponse._author}`)
    if (challengeResponse._author !== permalink) {
      throw new Errors.HandshakeFailed('signature does not match claimed identity')
    }

    // const promiseCredentials = this.createCredentials(session)
    const getLastSent = this.messages.getLastMessageTo({ recipient: permalink, body: false })
      .then(message => this.messages.getMessageStub({ message }))
      .catch(Errors.ignoreNotFound)

    Object.assign(session, {
      clientPosition: pickNonNull(position),
      serverPosition: pickNonNull({
        sent: await getLastSent
      }),
      authenticated: true,
      dateAuthenticated: Date.now()
    })

    this.tasks.add({
      name: 'savesession',
      promise: this.putSession(session)
    })

    return session
  }

  public createCredentials = async (clientId: string, role: string):Promise<IRoleCredentials> => {
    this.logger.debug(`generating temp keys for client ${clientId}, role ${role}`)
    this.logger.info('assuming role', role)
    const params:AWS.STS.AssumeRoleRequest = {
      RoleArn: role,
      RoleSessionName: randomString(16),
      DurationSeconds: this.sessionTTL
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
    clientId: string
    identity: IIdentity
    ips?: string[]
  }): Promise<IIotClientChallenge> => {
    try {
      typeforce({
        clientId: typeforce.String,
        identity: types.identity
      }, opts)
    } catch (err) {
      this.logger.error('received invalid input', { input: opts, stack: err.stack })
      throw new Errors.InvalidInput(err.message)
    }

    const { clientId, identity } = opts

    ensureNoVirtualProps({
      models: this.modelStore.models,
      resource: identity
    })

    const permalink = getPermalink(identity)
    if (permalink !== this.getPermalinkFromClientId(clientId)) {
      throw new Errors.InvalidInput('expected "clientId" to have format {permalink}{nonce}')
    }

    const maybeAddContact = this.identities.addContact(identity)
    const challenge = this.createChallenge()
    // const getIotEndpoint = this.iot.getEndpoint()
    // const saveSession = this.tables.Presence.put({
    //   Item: {
    //     clientId,
    //     permalink,
    //     challenge,
    //     time: Date.now(),
    //     authenticated: false,
    //     connected: false
    //   }
    // })

    const dateCreated = Date.now()
    const sessionProps = {
      [TYPE]: SESSION,
      _time: dateCreated,
      dateCreated,
      clientId,
      permalink,
      challenge,
      authenticated: false,
      connected: false,
      subscribed: false,
    }

    const session = await this.putSession(sessionProps)
    const resp:IIotClientChallenge = {
      time: Date.now(),
      challenge,
    }

    // need to wait for this
    // otherwise handleChallengeResponse may not find the pub key mapping
    await maybeAddContact
    return resp
  }

  public getUploadPrefix = (AssumedRoleUser: {
    AssumedRoleId: string
  }):string => {
    return `${this.uploadFolder}/${AssumedRoleUser.AssumedRoleId}/`
  }

  public getLiveSessionByClientId = (clientId): Promise<any> => {
    return this.getLiveSessionByPermalink(this.getPermalinkFromClientId(clientId))
  }

  public getKeyFromClientId = (clientId) => {
    return {
      [TYPE]: SESSION,
      clientId,
      permalink: this.getPermalinkFromClientId(clientId)
    }
  }

  public getPermalinkFromClientId = (clientId:string):string => {
    // split off stackName prefix if it's there
    const { clientIdPrefix } = this.iot
    if (clientIdPrefix && clientId.startsWith(clientIdPrefix)) {
      clientId = clientId.slice(clientIdPrefix.length)
    }

    if (!isHex(clientId)) {
      clientId = new Buffer(clientId, 'base64').toString('hex')
    }

    return clientId.slice(0, 64)
  }

  private updateSession = async (clientId, update, opts={}):Promise<ISession> => {
    update = {
      ...this.getKeyFromClientId(clientId),
      ...update
    }

    opts = merge({ ReturnValues: 'ALL_NEW' }, opts)
    return await this.db.update(update, opts)
  }
}

export { Auth }
