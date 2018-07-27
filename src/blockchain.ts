import { utils, protocol } from '@tradle/engine'
import { promisify, typeforce } from './utils'
import { prettify } from './string-utils'
import adapters from './blockchain-adapter'
import {
  IDebug,
  Logger,
  Identity,
  ITradleObject,
  IBlockchainIdentifier
} from './types'

import Errors from './errors'

type BalanceValue = string | number

interface IKey {
  fingerprint: string
  priv: string
}

interface ISealable {
  // link?: string
  // prevLink?: string
  headerHash?: string
  prevHeaderHash?: string
  object?: ITradleObject
  basePubKey: any
}

interface ISealOpts {
  key: IKey
  link: string
  address: string
  addressForPrev?: string
  balance?: BalanceValue
  [x: string]: any
}

interface IBlockchainAdapter {
  blockchain: string
  name: string
  minOutputAmount: BalanceValue
  pubKeyToAddress: (pub: string) => string
}

const compareNums = (a, b) => a - b
const compareBalance = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') {
    return compareNums(a, b)
  }

  if (typeof a === 'number') {
    a = a.toString(16)
  }

  if (typeof b === 'number') {
    b = b.toString(16)
  }

  if (typeof a !== 'string' || typeof b !== 'string') {
    throw new Error('expected numbers or hex strings')
  }

  const padLength = a.length - b.length
  if (padLength > 0) {
    b = '0'.repeat(padLength) + b
  } else if (padLength > 0) {
    a = '0'.repeat(padLength) + a
  }

  // can compare like nums
  return compareNums(a, b)
}

type BlockchainOpts = {
  logger: Logger
  network: IBlockchainIdentifier
  identity: Identity
}

export default class Blockchain {
  public flavor: string
  public networkName: string
  public minBalance: string

  private reader: any
  private network: IBlockchainAdapter
  private writers = {}
  private getTxAmount = () => this.network.minOutputAmount
  private debug:IDebug
  private logger:Logger
  private identity:Identity
  public addressesAPI: {
    transactions: (addresses: string[], blockHeight?: number) => Promise<any>,
    balance: (address: string) => Promise<string|number>
  }

  public getInfo: () => Promise<any>
  constructor(components:BlockchainOpts) {
    const { logger, network, identity } = components
    // typeforce({
    //   flavor: typeforce.String,
    //   networkName: typeforce.String,
    //   minBalance: typeforce.oneOf(typeforce.String, typeforce.Number)
    // }, blockchainIdentifier)

    Object.assign(this, network)

    const { flavor, networkName } = network
    if (!adapters[flavor]) {
      throw new Error(`unsupported blockchain type: ${flavor}`)
    }

    this.reader = this.createAdapter()
    this.addressesAPI = promisify(this.reader.blockchain.addresses)
    this.getInfo = promisify(this.reader.blockchain.info)
    this.network = this.reader.network
    this.logger = logger
    this.identity = identity
  }

  public toString = () => `${this.network.blockchain}:${this.network.name}`
  public pubKeyToAddress = (pub: string) => this.network.pubKeyToAddress(pub)

  public wrapOperation = fn => {
    return async (...args) => {
      this.start()
      try {
        return await fn(...args)
      } finally {
        this.stop()
      }
    }
  }

  public getBlockHeight = async () => {
    this.start()
    const { blockHeight } = await this.getInfo()
    return blockHeight
  }

  public getTxsForAddresses = async (addresses:string[], blockHeight?:number) => {
    this.start()
    // if (typeof blockHeight !== 'number') {
    //   blockHeight = await this.getBlockHeight()
    // }

    const txInfos = await this.addressesAPI.transactions(addresses, blockHeight)
    txInfos.forEach((info:any) => {
      if (!info.confirmations &&
        typeof info.blockHeight === 'number' &&
        typeof blockHeight === 'number') {
        info.confirmations = blockHeight - info.blockHeight
      }
    })

    if (txInfos.length) {
      this.logger.ridiculous(`fetched transactions for addresses: ${addresses.join(', ')}`, txInfos)
    } else {
      this.logger.ridiculous(`no transactions found for addresses: ${addresses.join(', ')}`)
    }

    return txInfos
  }

  // const sync = co(function* (addresses) {
  //   return getTxsForAddresses(addresses)
  // })

  public seal = async ({ key, link, address, addressForPrev, balance }: ISealOpts) => {
    const writer = this.getWriter(key)
    this.start()
    this.logger.debug(`sealing ${link}`)
    if (typeof balance === 'undefined') {
      try {
        balance = await this.balance()
      } catch (err) {
        this.logger.error('failed to get balance', err)
      }
    }

    const amount = this.getTxAmount()
    if (typeof balance !== 'undefined') {
      if (compareBalance(balance, amount) === -1) {
        throw new Errors.LowFunds(`have ${balance}, need at least ${amount}`)
      }
    }

    const addresses = [address]
    try {
      return await writer.send({
        to: addresses.map(address => ({ address, amount }))
      })
    } catch (err) {
      if (Errors.matches(err, { message: /insufficient/i })) {
        throw new Errors.LowFunds(err.message)
      }

      throw err
    }
  }

  public sealPubKey = (opts: ISealable) => {
    let { object, headerHash, basePubKey } = opts
    basePubKey = utils.toECKeyObj(basePubKey)
    return protocol.sealPubKey({ basePubKey, object, headerHash })
  }

  public sealPrevPubKey = (opts: ISealable) => {
    let { object, prevHeaderHash, basePubKey } = opts
    basePubKey = utils.toECKeyObj(basePubKey)
    return protocol.sealPrevPubKey({ object, prevHeaderHash, basePubKey })
  }

  public sealAddress = (opts: ISealable) => {
    const { object, headerHash, basePubKey } = opts
    const { pub } = this.sealPubKey({ object, headerHash, basePubKey })
    return this.network.pubKeyToAddress(pub)
  }

  public sealPrevAddress = (opts: ISealable ) => {
    const { object, prevHeaderHash, basePubKey } = opts
    const { pub } = this.sealPrevPubKey({ object, prevHeaderHash, basePubKey })
    return this.network.pubKeyToAddress(pub)
  }

  public start = () => this.startOrStop('start')
  public stop = () => this.startOrStop('stop')

  // lazy access this.tradle.provider, to prevent circular dep
  public getMyChainPub = () => this.identity.getChainKeyPub()
  public getMyChainAddress = ():Promise<string> => this.getMyChainPub()
    .then(({ fingerprint }) => fingerprint)

  public recharge = async (opts: {
    address?:string,
    minBalance?: string,
    force?: boolean
  }={}) => {
    let { address, minBalance, force } = opts
    if (!address) {
      address = await this.getMyChainAddress()
    }

    if (!minBalance) {
      minBalance = this.minBalance
    }

    const client = this.writers[address] || this.reader
    return client.recharge({ address, minBalance, force })
  }

  public balance = async (opts: {
    address?: string
  }={}):Promise<BalanceValue> => {
    let { address } = opts
    if (!address) {
      address = await this.getMyChainAddress()
    }

    const balance = await this.addressesAPI.balance(address)
    this.logger.debug(`balance: ${balance}`)
    return balance
  }

  private createAdapter = (opts:{ privateKey?: string }={}) => {
    const { flavor, networkName } = this
    const create = adapters[flavor]
    return create({ flavor, networkName, ...opts })
  }

  private getWriter = (key: IKey) => {
    const { fingerprint, priv } = key
    if (!this.writers[fingerprint]) {
      const { transactor } = this.createAdapter({
        privateKey: priv
      })

      this.writers[fingerprint] = promisify(transactor)
    }

    return this.writers[fingerprint]
  }

  private startOrStop = async (method: string) => {
    Object.keys(this.writers)
      .map(key => this.writers[key])
      .concat(this.reader.blockchain)
      .forEach(client => {
        if (client[method]) {
          client[method]()
        }
      })
  }
}

export { Blockchain }
