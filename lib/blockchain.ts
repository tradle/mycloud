const debug = require('debug')('tradle:sls:blockchain')
const { utils, protocol } = require('@tradle/engine')
const { promisify, typeforce } = require('./utils')
const { prettify } = require('./string-utils')
const adapters = require('./blockchain-adapter')
const ENV = require('./env')

interface BlockchainIdentifier {
  flavor: string,
  network: string,
  minBalance: string|number
}

interface Key {
  fingerprint: string
  priv: string
}

interface Sealable {
  link: string
  basePubKey: any
}

class Blockchain {
  private reader: any;
  private network: any;
  private writers = {};
  private flavor: string;
  private networkName: string;
  private minBalance: string;
  private blockchainIdentifier: BlockchainIdentifier;
  private getTxAmount = () => this.network.minOutputAmount

  private createAdapter = ({ privateKey }) => {
    const { flavor, networkName } = this
    const create = adapters[flavor]
    return create({ flavor, networkName, privateKey })
  }

  private getWriter = (key: Key) => {
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
    transactions: () => Promise<any>,
    balance: () => Promise<string|number>
  };

  public getInfo: () => Promise<any>;
  constructor(blockchainIdentifier: BlockchainIdentifier) {
    // typeforce({
    //   flavor: typeforce.String,
    //   networkName: typeforce.String,
    //   minBalance: typeforce.oneOf(typeforce.String, typeforce.Number)
    // }, blockchainIdentifier)

    Object.assign(this, blockchainIdentifier)

    const { flavor, networkName } = blockchainIdentifier
    const defaultMinBalance = blockchainIdentifier.minBalance
    if (!adapters[flavor]) {
      throw new Error(`unsupported blockchain type: ${flavor}`)
    }

    this.reader = this.createAdapter({ networkName })
    this.addressesAPI = promisify(this.reader.blockchain.addresses)
    this.getInfo = promisify(this.reader.blockchain.info)
    this.network = this.reader.network
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

  public getTxsForAddresses = async (addresses:T[], blockHeight?:number) => {
    this.start()
    // if (typeof blockHeight !== 'number') {
    //   blockHeight = await this.getBlockHeight()
    // }

    const txInfos = await this.addressesAPI.transactions(addresses, blockHeight)
    txInfos.forEach(info => {
      if (!info.confirmations && typeof info.blockHeight === 'number') {
        info.confirmations = blockHeight - info.blockHeight
      }
    })

    if (txInfos.length) {
      debug(`fetched transactions for addresses: ${addresses.join(', ')}: ${prettify(txInfos)}`)
    } else {
      debug(`no transactions found for addresses: ${addresses.join(', ')}`)
    }

    return txInfos
  }

  // const sync = co(function* (addresses) {
  //   return getTxsForAddresses(addresses)
  // })

  public seal = async ({ key, link, addresses }) => {
    const writer = this.getWriter(key)
    this.start()
    debug(`sealing ${link}`)
    debugger
    return await writer.send({
      to: addresses.map(address => {
        return {
          address,
          amount: this.getTxAmount()
        }
      })
    })
  }

  public sealPubKey = (opts: Sealable) => {
    let { link, basePubKey } = opts
    link = utils.linkToBuf(link)
    basePubKey = utils.toECKeyObj(basePubKey)
    return protocol.sealPubKey({ link, basePubKey })
  }

  public sealPrevPubKey = (opts: Sealable) => {
    let { link, basePubKey } = opts
    link = utils.linkToBuf(link)
    basePubKey = utils.toECKeyObj(basePubKey)
    return protocol.sealPrevPubKey({ link, basePubKey })
  }

  public sealAddress = (opts: Sealable) => {
    const { link, basePubKey } = opts
    const { pub } = this.sealPubKey({ link, basePubKey })
    return this.network.pubKeyToAddress(pub)
  }

  public sealPrevAddress = (opts: Sealable ) => {
    const { link, basePubKey } = opts
    const { pub } = this.sealPrevPubKey({ link, basePubKey })
    return this.network.pubKeyToAddress(pub)
  }

  public start = () => this.startOrStop('start')
  public stop = () => this.startOrStop('stop')
  public getMyChainPub = () => require('./').provider.getMyChainKeyPub()
  public getMyChainAddress = () => this.getMyChainPub()
    .then(({ fingerprint }) => fingerprint)

  public recharge = async (opts={}) => {
    let { address, minBalance, force } = opts
    if (!address) {
      address = await this.getMyChainAddress()
    }

    if (!minBalance) {
      minBalance = defaultMinBalance
    }

    const client = this.writers[address] || this.reader
    return client.recharge({ address, minBalance, force })
  }

  public balance = async (opts={}) => {
    let { address } = opts
    if (!address) {
      address = await this.getMyChainAddress()
    }

    return this.addressesAPI.balance(address)
  }
}

export = Blockchain

// module.exports = createWrapper(ENV.BLOCKCHAIN)
