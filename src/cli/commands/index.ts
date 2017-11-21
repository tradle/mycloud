import Tradle from '../../tradle'
import Env from '../../env'
import { CommandOpts, ICommand, Cli } from '../'

const registrar = {}

export class Command {
  protected cli: Cli
  protected env: Env
  protected tradle: Tradle
  protected bot: any
  constructor (cli:Cli) {
    this.cli = cli
    this.tradle = cli.tradle
    this.env = this.tradle.env
    this.bot = cli.bot
  }

  public confirm = async (message:string) => this.cli.confirm(message)
}

export const register = (name, command) => {
  registrar[name] = command
}

export const create = ({ name, cli }) => {
  const ctor = registrar[name]
  if (!name) {
    throw new Error(`command "${name}" not found`)
  }

  return ctor(cli)
}

register('clear-tables', require('./clear-tables'))
