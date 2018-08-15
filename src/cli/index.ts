
import readline from 'readline'
import yn from 'yn'
import Logger, { Writer } from '../logger'
import Env from '../env'
import testServiceMap from '../test/service-map'
import { loadConfAndComponents } from '../in-house-bot'
import { createBot } from '../'
import { get as getCommand } from './registrar'
import { CliOpts } from '../in-house-bot/types'

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
    } = await loadConfAndComponents({ bot })

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
