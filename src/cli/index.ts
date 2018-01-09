
import readline = require('readline')
import yn = require('yn')
import Logger, { Writer } from '../logger'
import Env from '../env'
import testServiceMap = require('../test/service-map')
import { customize } from '../samplebot/customize'
import { createBot } from '../bot'
import { list as listCommands, get as getCommand } from './registrar'
import Command from './command'
import { ICommand, CommandOpts, CliOpts } from '../types'

const remoteServiceMap = require('./remote-service-map')
const providerConf = require('../../conf/provider')

let instance

export default class Cli {
  public bot: any
  public remote: boolean
  public logger: Logger
  public env: Env
  public productsAPI: any
  public onfidoPlugin: any
  public ready: Promise<void>
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
    this.ready = this.init()
  }

  private init = async () => {
    const bot = createBot()
    this.bot = bot
    this.env = bot.env
    this.logger = this.env.sublogger(':cli')

    const {
      productsAPI,
      onfidoPlugin
    } = await customize({ bot })

    this.productsAPI = productsAPI
    this.onfidoPlugin = onfidoPlugin
  }

  public setWriter (writer:Writer, propagateToSubWriters:boolean) {
    this.logger.setWriter(writer, propagateToSubWriters)
  }

  public exec = async (name, opts):Promise<any> => {
    await this.ready
    const ctor = getCommand(name)
    const command = new ctor(this)
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
