import '../globals'

import Debug from 'debug'
import randomName from 'random-name'
import leveldown from 'memdown'
import mkdirp from 'mkdirp'
import once from 'lodash/once'
import Client from '@tradle/aws-client'
import tradle from '@tradle/engine'
import { TYPE, SEQ } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
import { getLink, getPermalink } from '../crypto'
import { get, omitVirtual } from '../utils'
import {
  IIdentity,
} from '../types'

const debug = Debug('mob')
const { utils } = tradle
const allUsers = require('./fixtures/users').slice()
const noop = () => {}

// const names = allUsers.map(user => randomName.first())

interface ProviderIotEndpoint {
  endpoint: string
  parentTopic: string
  clientIdPrefix: string
}

interface ProviderInfo {
  baseUrl: string
  permalink: string
  identity: IIdentity
  connectEndpoint: ProviderIotEndpoint
}

const AWS_CLIENT_PROP = '_awsClient'

export class Test {
  private provider: ProviderInfo
  private users: any[]
  public nodes: any[]
  constructor({
    users=allUsers.slice(),
    provider,
  }) {
    this.provider = provider
    // this.providerApiUrl = providerApiUrl
    this.users = users
    this.nodes = []
  }

  public addNodes = async n => {
    const nodes = makeNodes(this.users.slice(0, n))
    await Promise.all(nodes.map(node => this._initNode(node)))
    this.nodes = this.nodes.concat(nodes)
    this.users = this.users.slice(n)
  }

  private _initNode = async node => {
    const { provider } = this
    const client = createIotClient({ node, provider })
    const providerCoords = { permalink: provider.permalink }

    client.on('error', err => {
      debug(`ERROR: aws client experienced error: ${err.stack}`)
    })

    client.onmessage = async (msg) => {
      debug(`receiving msg ${msg._n} with ${msg.object._t} ${getLink(msg)} from ${provider.permalink}`)
      try {
        await node.receive(msg, providerCoords)
      } catch (err) {
        if (err.type !== 'exists') throw err
      }
    }

    node._send = async (message, recipientInfo, cb) => {
      if (!client._state) {
        // hack
        client.start()
      }

      try {
        await client.send({
          message,
          link: message.unserialized.link
        })
      } catch (err) {
        return cb(err)
      }

      cb()
    }

    node[AWS_CLIENT_PROP] = client
    await node.addContact(provider.identity)
  }

  public group = n => {
    const group = this.nodes.slice(0, n)
    const groupOp = (op, onProgress) => Promise.all(group.map(node => op(node).then(onProgress)))
    const wrapGroupOp = op => (onProgress=noop) => groupOp(op, onProgress)
    const connect = async node => {
      const client = node[AWS_CLIENT_PROP]
      client.start()
      await client.ready()
    }

    const pingPong = async node => this.pingPong(node)

    const groupApi = {
      connect: wrapGroupOp(connect),
      pingPong: wrapGroupOp(pingPong),
    }

    return groupApi
  }

  public pingPong = async (node) => {
    const promiseAck = new Promise(resolve => node[AWS_CLIENT_PROP].once('ack', resolve))
    const promisePong = awaitType(node, 'tradle.SimpleMessage')

    const client = node[AWS_CLIENT_PROP]
    await client.ready()

    await this._send(node, {
      _t: 'tradle.SelfIntroduction',
      identity: node.identity
    })

    await this._send(node, {
      _t: 'tradle.SimpleMessage',
      message: 'hey'
    })

    // await promiseAck
    // debug('delivered SelfIntroduction')
    await promisePong
    debug('received ho')
    await client.close()
    await node.destroy()
  }

  private _send = async (node, object) => {
    await node.signAndSend({
      to: { permalink: this.provider.permalink },
      object: {
        ...object,
        _time: object._time || Date.now()
      }
    })
  }
}

const awaitType = (node, type) => {
  return awaitEvent(node, 'message', ({ object }) => object.object._t === type)
}

const awaitEvent = (node, event, filter=acceptAll) => new Promise(resolve => {
  const checkEvent = (data) => {
    if (filter(data)) {
      node.removeListener('event', checkEvent)
      resolve()
    }
  }

  node.on(event, checkEvent)
})

const acceptAll = (item:any) => {
  return true
}

const makeNodes = users => {
  let blockchain
  return users.map((user, i) => {
    const opts = {
      identity: user.identity,
      keys: user.keys.map(k => utils.importKey(k)),
      name: `${user.profile.name.formatted}`,
      blockchain,
    }

    const node = createNode(opts)

    if (!blockchain) blockchain = node.blockchain

    return utils.promisifyNode(node)
  })
}

const rethrow = err => {
  if (err) throw err
}

export const getProviderInfo = async (baseUrl: string): Promise<ProviderInfo> => {
  const { bot, connectEndpoint } = await get(`${baseUrl}/info`)
  return {
    baseUrl,
    permalink: getPermalink(bot.pub),
    identity: bot.pub,
    connectEndpoint
  }
}

export const createTest = opts => new Test(opts)

export const testProvider = async ({ url, offset, n }) => {
  const provider = await getProviderInfo(url)
  const test = new Test({
    provider,
    users: allUsers.slice(offset, offset + n)
  })

  await test.addNodes(n)
  const group = test.group(n)
  await group.connect()
  console.log('ALL NODES CONNECTED')
  let i = 0
  await group.pingPong(() => console.log(`SENT/RECEIVED ${(++i)}/${n}`))
  console.log('ALL NODES SENT/RECEIVED')
}

const wrapWorkerMethod = fn => async (optsStr, callback) => {
  const promise = new Promise(async (resolve, reject) => {
    const SegfaultHandler = require('segfault-handler')
    const opts = JSON.parse(optsStr)
    const { i } = opts
    process.on('unhandledRejection', rej => {
      reject(new Error(`worker ${i} unhandled rejection: ${JSON.stringify(rej)}`))
    })

    SegfaultHandler.registerHandler(`clientest-crash-${i}.log`)

    let result
    try {
      result = await fn(opts)
    } catch (err) {
      return reject(err)
    }

    resolve(result)
  })

  let result
  try {
    result = await promise
  } catch (err) {
    return callback(err)
  }

  callback(null, result)
}

// workers
export const testProviderWorker = wrapWorkerMethod(testProvider)

const createNode = opts => {
  const {
    identity,
    keys,
    syncInterval=12000000
  } = opts

  const permalink = getPermalink(identity)
  const shortlink = permalink.slice(0, 10)
  const dir = `clienttest/${shortlink}`
  mkdirp.sync(dir)

  const keeper = utils.levelup(`${dir}/keeper.db`, {
    db: leveldown
  })

  opts = utils.extend(opts, {
    dir,
    keeper,
    leveldown,
    syncInterval
  })

  return tradle.node(opts)
}

const createIotClient = ({ node, provider }: {
  node: any
  provider: ProviderInfo
}) => {
  const counterparty = provider.permalink
  const { connectEndpoint } = provider
  return new Client({
    endpoint: provider.baseUrl,
    iotEndpoint: connectEndpoint.endpoint,
    parentTopic: connectEndpoint.parentTopic,
    node,
    counterparty,
    getSendPosition: () => getTip({
      node,
      counterparty,
      sent: true
    }),
    getReceivePosition: () => getTip({
      node,
      counterparty,
      sent: false,
    }),
    // position,
    // TODO: generate long-lived clientId: `${node.permalink}${nonce}`
    clientId: getIotClientId({ node, provider }),
    retryOnSend: 3, // then give up and re-queue
    autostart: false,
  })
}

const getTip = ({ node, counterparty, sent }) => {
  const from = sent ? node.permalink : counterparty
  const to = sent ? counterparty : node.permalink
  const seqOpts:any = {}
  const base = from + '!' + to
  seqOpts.gte = base + '!'
  seqOpts.lte = base + '\xff'
  seqOpts.reverse = true
  seqOpts.limit = 1
  // console.log(seqOpts)
  const source = node.objects.bySeq(seqOpts)
  return new Promise((resolve, reject) => {
    source.on('error', reject)
    source.on('data', data => resolve({
      time: data.timestamp,
      link: data.link
    }))

    source.on('end', () => resolve(null))
  })
}

const getIotClientId = ({ node, provider }) => {
  const { connectEndpoint } = provider
  const prefix = connectEndpoint.clientIdPrefix || ''
  return `${prefix}${node.permalink}${provider.permalink.slice(0, 6)}`
  // return new Buffer(`${permalink}${counterparty.slice(0, 6)}`, 'hex').toString('base64')
}

// testBlop().catch(console.error)
