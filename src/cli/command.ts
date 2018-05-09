import { Env, Bot } from '../types'
import Cli from './'

export default class Command {
  protected cli: Cli
  protected env: Env
  protected bot: Bot
  constructor (cli:Cli) {
    this.cli = cli
    this.env = cli.env
    this.bot = cli.bot
  }

  public confirm = async (message:string) => this.cli.confirm(message)
}
