import { utils, protocol } from '@tradle/engine'
import adapters from './blockchain-adapter'
import {
  IDebug,
  Logger,
  Identity,
  ITradleObject,
  IBlockchainIdentifier,
  LowFundsInput,
} from './types'

import { alphabetical, unprefixHex } from './string-utils'

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
const compareHexStrs = (a, b) => {
  a = unprefixHex(a)
  b = unprefixHex(b)

  const padLength = a.length - b.length
  if (padLength > 0) {
    b = '0'.repeat(padLength) + b
  } else if (padLength > 0) {
    a = '0'.repeat(padLength) + a
  }

  return alphabetical(a, b)
}

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

  // can compare like nums
  return compareHexStrs(a, b)
}

const toLowerCase = str => str.toLowerCase()

type BlockchainOpts = {
  logger: Logger
  network: IBlockchainIdentifier
  identity: Identity
}

export default class Blockchain {
  public blockchain: string
  public networkName: string
  public minBalance: string

  private reader: any
  private network: IBlockchainAdapter
  private writers = {}
  private getTxAmount = () => this.network.minOutputAmount
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
    //   blockchain: typeforce.String,
    //   networkName: typeforce.String,
    //   minBalance: typeforce.oneOf(typeforce.String, typeforce.Number)
    // }, blockchainIdentifier)

    Object.assign(this, network)

    const { blockchain, networkName } = network
    if (!adapters[blockchain]) {
      throw new Error(`unsupported blockchain type: ${blockchain}`)
    }

    this.reader = this.createAdapter()
    this.addressesAPI = this.reader.blockchain.addresses
    this.getInfo = this.reader.blockchain.info
    this.network = this.reader.network
    this.logger = logger
    this.identity = identity
  }

  public toString = () => `${this.network.blockchain}:${this.network.name}`
  public pubKeyToAddress = (pub: string) => this.network.pubKeyToAddress(pub).toLowerCase()

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

      ;['from', 'to'].forEach(group => {
        const val = info[group]
        if (val && val.addresses) {
          val.addresses = val.addresses.map(toLowerCase)
        }
      })
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
    const { minBalance } = this
    if (typeof balance === 'undefined') {
      try {
        balance = await this.balance()
      } catch (err) {
        this.logger.error('failed to get balance', err)
      }
    }

    const lowFunds:LowFundsInput = {
      blockchain: this.blockchain,
      networkName: this.networkName,
      address: await this.getMyChainAddress(),
      balance,
      minBalance,
    }

    const amount = this.getTxAmount()
    if (typeof balance !== 'undefined') {
      if (compareBalance(balance, amount) === -1) {
        throw new Errors.LowFunds({
          ...lowFunds,
          minBalance: amount
        })
      }
    }

    const addresses = [address]
    try {
      return await writer.send({
        to: addresses.map(address => ({ address, amount }))
      })
    } catch (err) {
      if (Errors.matches(err, { message: /insufficient/i })) {
        throw new Errors.LowFunds(lowFunds)
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

    return await this.addressesAPI.balance(address)
  }

  private createAdapter = (opts:{ priv?: string, fingerprint?: string }={}) => {
    const { priv, fingerprint } = opts
    const { blockchain, networkName } = this
    const create = adapters[blockchain]
    return create({
      blockchain,
      networkName,
      privateKey: priv,
      address: fingerprint,
    })
  }

  private getWriter = (key: IKey) => {
    const { fingerprint } = key
    if (!this.writers[fingerprint]) {
      const { transactor } = this.createAdapter(key)
      this.writers[fingerprint] = transactor
    }

    return this.writers[fingerprint]
  }

  private startOrStop = (method: string) => {
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
