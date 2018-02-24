import { TYPE } from '@tradle/constants'
import Cli from '../'
import Command from '../command'
import { ICommand } from '../../in-house-bot/types'

export default class Send extends Command {
  public static description = 'sends a message'
  public parse = message => {
    return {
      [TYPE]: 'tradle.SimpleMessage',
      message
    }
  }

  public exec = opts => this.bot.send(opts)
}
