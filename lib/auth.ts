const debug = require('debug')('tradle:sls:auth')
import { getUpdateParams } from './db-utils'
import { typeforce, defineGetter } from './utils'
import { prettify } from './string-utils'
import { randomString, getPermalink } from './crypto'
import Errors = require('./errors')
import * as types from './typeforce-types'
import { constants } from './'
import { Session, Identities, IotClientResponse } from './types/index.d'
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
//     debug(`Failed to delete clientId => permalink mapping in ${Presence}`, err)
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
  private env: any
  private aws: any
  private resources: any
  private tables: any
  private identities: Identities
  private objects: any
  private messages: any
  constructor (opts: {
    env: any,
    aws: any,
    resources: any,
    tables: any,
    identities: Identities,
    objects: any,
    messages: any
  }) {
    // lazy define
    [
      'env', 'aws', 'resources', 'tables',
      'identities', 'objects', 'messages'
    ].forEach(prop => defineGetter(this, prop, () => opts[prop]))
  }

  public onAuthenticated = async (session:Session): Promise<void> => {
    session = {
      ...session,
      authenticated: true
    }

    debug('saving session', prettify(session))

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

  public getSessionsByPermalink = (permalink: string): Promise<any> => {
    return this.tables.Presence.find(getSessionsByPermalinkQuery(permalink))
  }

  public getLiveSessionByPermalink = async (permalink: string): Promise<any> => {
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

    debug('latest authenticated session:', prettify(latest))
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

  public createChallenge = async (opts: {
    clientId: string,
    permalink: string
  }): Promise<string> => {
    const { clientId, permalink } = opts
    // const permalink = getPermalinkFromClientId(clientId)
    const challenge = randomString(32)
    const Item:Session = {
      clientId,
      permalink,
      challenge,
      time: Date.now(),
      authenticated: false,
      connected: false
    }

    await this.tables.Presence.put({ Item })
    return challenge
  }

  // const sendChallenge = co(function* ({ clientId, permalink }) {
  //   const challenge = await createChallenge({ clientId, permalink })
  //   await Iot.sendChallenge({ clientId, challenge })
  // })

  public handleChallengeResponse = async (response: {
    clientId: string,
    permalink: string,
    challenge: string,
    position: any
  }): Promise<Session> => {
    // TODO: get rid of this after TypeScript migration
    try {
      typeforce({
        clientId: typeforce.String,
        permalink: typeforce.String,
        challenge: typeforce.String,
        position: types.position
      }, response)
    } catch (err) {
      debug('received invalid input', err.stack)
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

  public getTemporaryIdentity = async (opts: {
    accountId: string,
    clientId: string,
    identity: string
  }): Promise<IotClientResponse> => {
    try {
      typeforce({
        accountId: typeforce.String,
        clientId: typeforce.String,
        identity: types.identity
      }, opts)
    } catch (err) {
      debug('received invalid input', err.stack)
      throw new InvalidInput(err.message)
    }

    const { accountId, clientId, identity } = opts
    const permalink = getPermalink(identity)
    if (permalink !== getPermalinkFromClientId(clientId)) {
      throw new InvalidInput('expected "clientId" to have format {permalink}{nonce}')
    }

    const maybeAddContact = this.identities.validateAndAdd(identity)
    const role = `arn:aws:iam::${accountId}:role/${this.resources.Role.IotClient}`
    debug(`generating temp keys for client ${clientId}, role ${role}`)

    // get the account id which will be used to assume a role

    debug('assuming role', role)
    const params = {
      RoleArn: role,
      RoleSessionName: randomString(16),
    }

    // assume role returns temporary keys
    const [challenge] = await Promise.all([
      this.createChallenge({ clientId, permalink }),
      maybeAddContact
    ])

    const {
      AssumedRoleUser,
      Credentials
    } = await this.aws.sts.assumeRole(params).promise()

    debug('assumed role', role)
    return {
      iotEndpoint: this.env.IOT_ENDPOINT,
      iotTopicPrefix: this.env.IOT_TOPIC_PREFIX,
      region: this.env.AWS_REGION,
      accessKey: Credentials.AccessKeyId,
      secretKey: Credentials.SecretAccessKey,
      sessionToken: Credentials.SessionToken,
      uploadPrefix: this.getUploadPrefix(AssumedRoleUser),
      time: Date.now(),
      challenge
    }
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
