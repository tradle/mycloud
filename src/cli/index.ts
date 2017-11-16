
import readline = require('readline')
import yn = require('yn')
import Tradle from '../tradle'
import Logger, { Writer } from '../logger'
import Env from '../env'
import remoteServiceMap = require('./remote-service-map')
import testServiceMap = require('../test/service-map')
import {
  Command,
  register as registerCommand,
  create as createCommand
} from './commands'

export type CliOpts = {
  remote?: boolean
  console?: any
}

export type CommandOpts = {
  requiresConfirmation: boolean
  description: string
  exec: (any) => Promise<any>
}

export interface ICommand {
  exec: (any) => Promise<any>
}

export default class Cli {
  public tradle: Tradle
  public remote: boolean
  public logger: Logger
  public env: Env
  constructor ({ remote }: CliOpts) {
    this.remote = !!remote

    const serviceMap = remote ? remoteServiceMap : testServiceMap
    const env = new Env({
      ...serviceMap,
      ...process.env,
      console
    })

    this.tradle = new Tradle(env)
    this.logger = env.sublogger('cli')
    this.env = env
  }

  public setWriter (writer:Writer, propagateToSubWriters:boolean) {
    this.tradle.logger.setWriter(writer, propagateToSubWriters)
  }

  public exec = async (name, opts):Promise<any> => {
    const command = createCommand({ cli: this, name })
    return await command.exec(opts)
  }

  public confirm = async (msg:string) => {
    const rl = readline.createInterface(process.stdin, process.stdout)
    const answer = await new Promise(resolve => {
      rl.question(`${msg}\ncontinue? y/[n]:`, resolve)
    })

    rl.close()
    if (!yn(answer)) {
      throw new Error('confirmation denied')
    }
  }
}
