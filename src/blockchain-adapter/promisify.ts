import { promisify } from '../utils'

export const promisifyAdapter = adapter => {
  const promisified = {
    info: adapter.info && promisify(adapter.info),
    blocks: promisify(adapter.blocks),
    addresses: promisify(adapter.addresses),
    transactions: promisify(adapter.transactions),
  }

  return new Proxy(adapter, {
    get: (obj, prop) => promisified[prop] || obj[prop]
  })
}

export const promisifyTransactor = transactor => {
  const promisified = {
    send: promisify(transactor.send),
  }

  return new Proxy(transactor, {
    get: (obj, prop) => promisified[prop] || obj[prop]
  })
}
