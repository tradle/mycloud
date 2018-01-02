import Cli, { CommandOpts, ICommand } from '../'
import Command from '../command'

export default class Send extends Command implements ICommand {
  public static description = 'sends a message'
  public exec = opts => this.bot.send({
    ...opts,
    object: typeof opts.object === 'string'
      ? { _t: 'tradle.SimpleMessage', message: opts.object }
      : opts.object
  })
}
