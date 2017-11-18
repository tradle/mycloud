
import readline = require('readline')
import yn = require('yn')
import Tradle from '../tradle'
import Logger, { Writer } from '../logger'
import Env from '../env'
import remoteServiceMap = require('./remote-service-map')
import testServiceMap = require('../test/service-map')
import createBot from '../samplebot/bot'
import providerConf = require('../../conf/provider')
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

let instance

export default class Cli {
  public tradle: Tradle
  public bot: any
  public remote: boolean
  public logger: Logger
  public env: Env
  public productsAPI: any
  public onfidoPlugin: any
  constructor ({ remote }: CliOpts) {
    if (instance) throw new Error('only one instance allowed')

    this.remote = !!remote

    const serviceMap = remote ? remoteServiceMap : testServiceMap
    const processEnv = {
      ...serviceMap,
      ...providerConf.env,
      ...process.env
    }

    if (!this.remote) {
      // some resources are unavailable
      processEnv.IS_LOCAL = true
      // serverless-offline
      processEnv.IS_OFFLINE = true
    }

    Object.assign(process.env, processEnv)

    const {
      tradle,
      bot,
      productsAPI,
      onfidoPlugin
    } = createBot(processEnv)

    this.tradle = tradle
    this.bot = bot
    this.productsAPI = productsAPI
    this.onfidoPlugin = onfidoPlugin
    this.env = this.tradle.env
    this.logger = this.env.sublogger(':cli')
  }

  public setWriter (writer:Writer, propagateToSubWriters:boolean) {
    this.logger.setWriter(writer, propagateToSubWriters)
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
