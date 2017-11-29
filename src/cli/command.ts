import Tradle from '../../tradle'
import Env from '../../env'
import { CommandOpts, ICommand, Cli } from '../'

export default class Command {
  protected cli: Cli
  protected env: Env
  protected tradle: Tradle
  protected bot: any
  constructor (cli:Cli) {
    this.cli = cli
    this.env = cli.env
    this.bot = cli.bot
  }

  public confirm = async (message:string) => this.cli.confirm(message)
}
