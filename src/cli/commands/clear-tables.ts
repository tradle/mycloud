import Tradle from '../../tradle'
import Env from '../../env'
import Logger from '../../logger'
import Cli, { CommandOpts, ICommand } from '../'
import Command from '../command'
import { prettify } from '../../string-utils'

const skip = [
  'pubkeys',
  'presence',
  'events',
  'seals',
  'tradle_MyCloudFriend'
]

export default class ClearTables extends Command implements ICommand {
  public static requiresConfirmation = true
  public static description = 'this will clear tables in the REMOTE DynamoDB'
  private logger: Logger
  constructor (cli:Cli) {
    super(cli)
    this.logger = cli.logger.sub('clear-tables')
  }

  public exec = async (names) => {
    const tables = await this.getTables(names)
    await this.clearTables(tables)
  }

  private getTables = async (names) => {
    const { tradle, env } = this
    if (names.length) {
      return names.map(name => {
        return name.startsWith(env.SERVERLESS_PREFIX) ? name : env.SERVERLESS_PREFIX + name
      })
    }

    const list = await tradle.dbUtils.listTables(env)
    return list.filter(name => {
      return !skip.find(skippable => env.SERVERLESS_PREFIX + skippable === name)
    })
  }

  private clearTables = async (names) => {
    const { href } = this.tradle.aws.dynamodb.endpoint
    await this.confirm(`will empty the following tables at endpoint ${href}\n${prettify(names)}`)

    for (const table of names) {
      this.logger.debug('clearing', table)
      const numDeleted = await this.tradle.dbUtils.clear(table)
      this.logger.debug(`deleted ${numDeleted} items from ${table}`)
    }
  }
}
