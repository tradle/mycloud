import Env from './env'
import Tradle from './tradle'

const { utils, protocol } = require('@tradle/engine')
const { promisify, typeforce } = require('./utils')
const { prettify } = require('./string-utils')
const adapters = require('./blockchain-adapter')

interface IBlockchainIdentifier {
  flavor: string,
  networkName: string,
  minBalance: string
}

interface IKey {
  fingerprint: string
  priv: string
}

interface ISealable {
  link?: string
  prevLink?: string
  basePubKey: any
}

export default class Blockchain {
  private reader: any
  private network: any
  private writers = {}
  private flavor: string
  private networkName: string
  private minBalance: string
  private blockchainIdentifier: IBlockchainIdentifier
  private getTxAmount = () => this.network.minOutputAmount
  private debug:(...any) => void
  private tradle:Tradle

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

  public addressesAPI: {
    transactions: (addresses: string[], blockHeight?: number) => Promise<any>,
    balance: (address: string) => Promise<string|number>
  }

  public getInfo: () => Promise<any>
  constructor(tradle:Tradle) {
    this.tradle = tradle
    const { env, network } = tradle
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
    this.debug = env.logger('blockchain')
  }

  public toString = () => `${this.network.blockchain}:${this.network.name}`
  public pubKeyToAddress = (...args) => this.network.pubKeyToAddress(...args)

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

  public getTxsForAddresses = async (addresses:Array<string>, blockHeight?:number) => {
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
      this.debug(`fetched transactions for addresses: ${addresses.join(', ')}: ${prettify(txInfos)}`)
    } else {
      this.debug(`no transactions found for addresses: ${addresses.join(', ')}`)
    }

    return txInfos
  }

  // const sync = co(function* (addresses) {
  //   return getTxsForAddresses(addresses)
  // })

  public seal = async ({ key, link, addresses }) => {
    const writer = this.getWriter(key)
    this.start()
    this.debug(`sealing ${link}`)
    return await writer.send({
      to: addresses.map(address => {
        return {
          address,
          amount: this.getTxAmount()
        }
      })
    })
  }

  public sealPubKey = (opts: ISealable) => {
    let { link, basePubKey } = opts
    link = utils.linkToBuf(link)
    basePubKey = utils.toECKeyObj(basePubKey)
    return protocol.sealPubKey({ link, basePubKey })
  }

  public sealPrevPubKey = (opts: ISealable) => {
    let { link, basePubKey } = opts
    link = utils.linkToBuf(link)
    basePubKey = utils.toECKeyObj(basePubKey)
    return protocol.sealPrevPubKey({ link, basePubKey })
  }

  public sealAddress = (opts: ISealable) => {
    const { link, basePubKey } = opts
    const { pub } = this.sealPubKey({ link, basePubKey })
    return this.network.pubKeyToAddress(pub)
  }

  public sealPrevAddress = (opts: ISealable ) => {
    const { link, basePubKey } = opts
    const { pub } = this.sealPrevPubKey({ link, basePubKey })
    return this.network.pubKeyToAddress(pub)
  }

  public start = () => this.startOrStop('start')
  public stop = () => this.startOrStop('stop')

  // lazy access this.tradle.provider, to prevent circular dep
  public getMyChainPub = () => this.tradle.provider.getMyChainKeyPub()
  public getMyChainAddress = ():Promise<string> => this.getMyChainPub()
    .then(({ fingerprint }) => fingerprint)

  public recharge = async (opts: {
    address:string,
    minBalance: string,
    force?: boolean
  }) => {
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
  }={}) => {
    let { address } = opts
    if (!address) {
      address = await this.getMyChainAddress()
    }

    return this.addressesAPI.balance(address)
  }
}
