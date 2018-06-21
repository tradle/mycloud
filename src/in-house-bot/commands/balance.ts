// @ts-ignore
import Promise from 'bluebird'
import { ICommand, Bot } from '../types'
import Errors from '../../errors'

export const command:ICommand = {
  name: 'balance',
  description: `attempt to repair any known issues`,
  examples: [
    '/balance',
  ],
  exec: async ({ commander, req, ctx, args }) => {
    if (!ctx.sudo) throw new Error('forbidden')

    const { blockchain } = commander.bot
    if (blockchain && typeof blockchain.balance === 'function') {
      blockchain.start()
      const [address, balance] = await Promise.all([
        blockchain.getMyChainAddress(),
        blockchain.balance()
      ])

      blockchain.stop()
      return {
        blockchain: blockchain.flavor,
        network: blockchain.networkName,
        address,
        balance
      }
    }

    throw new Errors.InvalidInput('unsupported')
  },
  sendResult: async ({ commander, req, to, result }) => {
    const { address, balance } = result
    await commander.sendSimpleMessage({
      req,
      to,
      message: `address: ${address}\nbalance: ${balance}`
    })
  }
}
