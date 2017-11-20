import { getUpdateParams } from './db-utils'
import { typeforce, defineGetter } from './utils'
import { prettify } from './string-utils'
import { randomString, getPermalink } from './crypto'
import * as Errors from './errors'
import * as types from './typeforce-types'
import Identities from './identities'
import Messages from './messages'
import Objects from './objects'
import Env from './env'
import * as constants from './constants'
import { IDebug, ISession, IotClientResponse, IIdentity } from './types/index.d'
import Logger from './logger'
const { HANDSHAKE_TIMEOUT } = constants
const { HandshakeFailed, InvalidInput, NotFound } = Errors

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
  private aws: any
  private resources: any
  private tables: any
  private identities: Identities
  private objects: Objects
  private messages: Messages
  private iot: any
  private debug: IDebug
  private logger: Logger
  constructor (opts: {
    env: Env,
    aws: any,
    resources: any,
    tables: any,
    identities: Identities,
    objects: Objects,
    messages: Messages,
    iot: any
  }) {
    // lazy define
    [
      'env', 'aws', 'resources', 'tables',
      'identities', 'objects', 'messages', 'iot'
    ].forEach(prop => defineGetter(this, prop, () => opts[prop]))

    this.logger = this.env.sublogger('auth')
  }

  public onAuthenticated = async (session:ISession): Promise<void> => {
    session = {
      ...session,
      authenticated: true
    }

    this.logger.debug('saving session', session)

    // allow multiple sessions for the same user?
    // await deleteSessionsByPermalink(permalink)
    await this.tables.Presence.put({ Item: session })
  }

  public updatePresence = (opts: {
    clientId: string,
    connected: boolean
  }): Promise<any> => {
    const { clientId, connected } = opts
    const params: any = getUpdateParams({ connected })
    params.Key = getKeyFromClientId(clientId)
    return this.tables.Presence.update(params)
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

  public handleChallengeResponse = async (response: {
    clientId: string,
    permalink: string,
    challenge: string,
    position: any
  }): Promise<ISession> => {
    // TODO: get rid of this after TypeScript migration
    try {
      typeforce({
        clientId: typeforce.String,
        permalink: typeforce.String,
        challenge: typeforce.String,
        position: types.position
      }, response)
    } catch (err) {
      this.logger.error('received invalid input', err.stack)
      throw new InvalidInput(err.message)
    }

    const { clientId, permalink, challenge, position } = response

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
    this.objects.addMetadata(response)
    await this.identities.addAuthorInfo(response)

    // console.log(`claimed: ${permalink}, actual: ${response._author}`)
    if (response._author !== permalink) {
      throw new HandshakeFailed('signature does not match claimed identity')
    }

    const getLastSent = this.messages.getLastMessageTo({ recipient: permalink, body: false })
      .then(message => this.messages.getMessageStub({ message }))
      .catch(err => {
        if (err instanceof NotFound) return null

        throw err
      })

    session.clientPosition = position
    session.serverPosition = {
      sent: await getLastSent
    }

    await this.onAuthenticated(session)
    return session
  }

  public createTemporaryIdentity = async (opts: {
    accountId: string,
    clientId: string,
    identity: IIdentity
  }): Promise<IotClientResponse> => {
    try {
      typeforce({
        accountId: typeforce.String,
        clientId: typeforce.String,
        identity: types.identity
      }, opts)
    } catch (err) {
      this.logger.error('received invalid input', { input: opts, stack: err.stack })
      throw new InvalidInput(err.message)
    }

    const { accountId, clientId, identity } = opts
    const permalink = getPermalink(identity)
    if (permalink !== getPermalinkFromClientId(clientId)) {
      throw new InvalidInput('expected "clientId" to have format {permalink}{nonce}')
    }

    const maybeAddContact = this.identities.validateAndAdd(identity)
    const role = `arn:aws:iam::${accountId}:role/${this.resources.Role.IotClient}`
    this.logger.debug(`generating temp keys for client ${clientId}, role ${role}`)

    // get the account id which will be used to assume a role

    this.logger.info('assuming role', role)
    const params = {
      RoleArn: role,
      RoleSessionName: randomString(16),
    }

    // assume role returns temporary keys
    const challenge = this.createChallenge()
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

    const {
      AssumedRoleUser,
      Credentials
    } = await this.aws.sts.assumeRole(params).promise()

    this.logger.debug('assumed role', role)
    const resp:IotClientResponse = {
      iotEndpoint: await this.iot.getEndpoint(),
      iotParentTopic: this.env.IOT_PARENT_TOPIC,
      region: this.env.AWS_REGION,
      accessKey: Credentials.AccessKeyId,
      secretKey: Credentials.SecretAccessKey,
      sessionToken: Credentials.SessionToken,
      uploadPrefix: this.getUploadPrefix(AssumedRoleUser),
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
    return `${this.resources.Bucket.FileUpload}/${AssumedRoleUser.AssumedRoleId}/`
  }

  public getMostRecentSessionByClientId = (clientId): Promise<any> => {
    return this.getLiveSessionByPermalink(getPermalinkFromClientId(clientId))
  }
}

// const isMostRecentSession = co(function* ({ clientId }) {
//   try {
//     const session = await getLiveSessionByPermalink(getPermalinkFromClientId(clientId))
//     return session.clientId === clientId
//   } catch (err) {}
// })


function getPermalinkFromClientId (clientId) {
  return clientId.slice(0, 64)
}

function getKeyFromClientId (clientId) {
  return {
    clientId,
    permalink: getPermalinkFromClientId(clientId)
  }
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
