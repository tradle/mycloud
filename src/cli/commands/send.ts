import { TYPE } from '@tradle/constants'
import Command from '../command'

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
