import QS from 'querystring'
import _ from 'lodash'
import { Env } from './env'
import { Seals } from './seals'
import { Tradle } from './tradle'
import { fetch, processResponse } from './utils'

const PLACEHOLDER = '<n/a>'
const noop = () => {}
const promiseNoop = async () => {}
const identityFn = val => val
const emptyPubShim = () => ({ pub: PLACEHOLDER })
const emptyAddressShim = pub => PLACEHOLDER
const getEndpointFromEnv = (env:Env):CordaApiEndpoint|void => {
  const { CORDA_API_URL, CORDA_API_KEY } = env
  if (CORDA_API_URL) {
    return {
      apiUrl: CORDA_API_URL,
      apiKey: CORDA_API_KEY
    }
  }
}

export type CordaApiEndpoint = {
  apiUrl: string
  apiKey?: string
}

export class CordaRestClient {
  private endpoint: CordaApiEndpoint
  constructor(endpoint?:CordaApiEndpoint) {
    this.endpoint = endpoint
  }

  public seal = async ({ link, counterparty }) => {
    return await this.post(`${this.endpoint.apiUrl}/item`, {
      link,
      partyTmpId: counterparty
    })
  }

  public setEndpoint = (endpoint:CordaApiEndpoint) => {
    this.endpoint = endpoint
  }

  private post = async (url:string, data:any) => {
    if (!(this.endpoint && this.endpoint.apiUrl)) {
      throw new Error(`don't know Corda REST endpoint, use setEndpoint to set`)
    }

    const res = await fetch(url, {
      method: 'POST',
      // url-encoded body
      body: QS.stringify(data),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Authorization: this.endpoint.apiKey
      }
    })

    return await processResponse(res)
  }
}

export class Blockchain {
  public flavor: string
  public networkName: string
  public minBalance: number
  private client: CordaRestClient
  constructor(opts) {
    const { env, endpoint, network } = opts

    this.client = new CordaRestClient(endpoint || getEndpointFromEnv(env))
    _.extend(this, _.pick(network, ['flavor', 'networkName', 'minBalance']))
  }

  public start = noop
  public wrapOperation = identityFn
  public sealPubKey = emptyPubShim
  public sealPrevPubKey = emptyPubShim
  public pubKeyToAddress = emptyAddressShim
  public seal = async (opts) => {
    return await this.client.seal(opts)
  }

  public setEndpoint = opts => this.client.setEndpoint(opts)
}

class CordaSeals {
  public blockchain: Blockchain
  public seals: Seals
  constructor(tradle:Tradle) {
    // this.blockchain = tradle.blockchain = new Blockchain(tradle)
    let seals
    Object.defineProperty(this, 'seals', {
      get() {
        if (!seals) seals = new Seals(tradle)
        return seals
      }
    })

    // @ts-ignore
    this.blockchain = tradle.blockchain
  }

  // proxy to this.seals
  public create = opts => this.seals.create(opts)
  public sealPending = (opts={}) => {
    return this.seals.sealPending({
      ...opts,
      key: {
        priv: PLACEHOLDER,
        pub: PLACEHOLDER
      }
    })
  }

  public writePendingSeal = (opts) => {
    return this.seals.writePendingSeal({
      ...opts,
      key: {
        priv: PLACEHOLDER,
        pub: PLACEHOLDER
      }
    })
  }

  public watch = promiseNoop
  public watchNextVersion = promiseNoop
  public syncUnconfirmed = opts => promiseNoop
  public getUnconfirmed = opts => this.seals.getUnconfirmed(opts)
  public getLongUnconfirmed = opts => this.seals.getLongUnconfirmed(opts)
  public getUnsealed = opts => this.seals.getUnsealed(opts)
  public get = opts => this.seals.get(opts)
  public handleFailures = promiseNoop
  public getFailedReads = async () => []
  public getFailedWrites = async () => []
  public requeueFailedWrites = promiseNoop
  public setEndpoint = opts => this.blockchain.setEndpoint(opts)
}

export {
  CordaSeals as Seals
}
