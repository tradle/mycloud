import { TYPE } from '@tradle/constants'
import Cli, { CommandOpts, ICommand } from '../'
import Command from '../command'

export default class Send extends Command implements ICommand {
  public static description = 'sends a message'
  public parse = message => {
    return {
      [TYPE]: 'tradle.SimpleMessage',
      message
    }
  }

  public exec = opts => this.bot.send(opts)
}
