import { omit } from 'lodash'
import parse from 'yargs-parser'
import { TYPE } from '@tradle/constants'
import { Errors as ProductBotErrors } from '@tradle/bot-products'
import {
  randomString
} from '../crypto'

import {
  IConf,
  ICommand,
  ICommandContext,
  ICommandInput,
  ICommandOutput,
  ICommandOutput1,
  ICommandParams,
  IDeferredCommandParams,
  Bot,
  IBotComponents,
  Deployment,
  IPBReq,
  IKeyValueStore,
  Applications,
  Friends
} from './types'

import { parseStub } from '../utils'
import Errors from '../errors'
import * as commands from './commands'
import Logger from '../logger'

const prettify = obj => JSON.stringify(obj, null, 2)
const COMMAND_REGEX = /^\/?([^\s]+)\s*(.*)?\s*$/
const FORBIDDEN_MESSAGE = 'Who do you think you are, the admin? This attempt will be logged.'
const NOT_FOUND_MESSAGE = 'command not found'
const SUDO = {
  employee: true,
  allowed: true
}

interface IConfirmationState {
  command: ICommandParams
  dateCreated: number
  dateExpires?: number
  ttl?: number // seconds
  confirmed?: boolean
  extra?: any
}

interface IExecCredentials {
  sudo?: boolean
  employee?: boolean
}

interface IExecOpts extends ICommandParams {
  // credentials: IExecCredentials
  req?: IPBReq
}

// export const EMPLOYEE_COMMANDS = [
//   'help',
//   'listproducts',
//   'forgetme',
//   'setproductenabled',
//   // 'setautoverify',
//   'setautoapprove',
//   'addfriend',
//   'tours',
//   'message',
//   'getconf',
//   'approve',
//   'deny',
//   'getlaunchlink',
//   'model'
// ]

export const DEFAULT_ERROR_MESSAGE = `sorry, I don't understand. To see the list of supported commands, type: /help`
export const COMMANDS = Object.keys(commands).map(key => commands[key].name || key)
export const SUDO_ONLY_COMMANDS = [
  'delete-forever-with-no-undo',
  'clear',
  'reset-identity-with-no-undo',
  'setenvvar',
  'push-notifications',
  'doctor',
  // 'encryptbucket',
  // 'enablebinary'
]

export const EMPLOYEE_COMMANDS = COMMANDS.filter(name => !SUDO_ONLY_COMMANDS.includes(name))
export const CUSTOMER_COMMANDS = [
  'help',
  'listproducts',
  'forgetme',
  'tours',
  'updatemycloud'
]

// export const SUDO_COMMANDS = EMPLOYEE_COMMANDS.concat(SUDO_ONLY_COMMANDS)

export interface CommanderOpts extends IBotComponents {
  store: IKeyValueStore
}

export class Commander {
  public bot: Bot
  public friends: Friends
  public productsAPI:any
  public employeeManager:any
  public applications:Applications
  public deployment?: Deployment
  public conf: IConf
  public logger: Logger
  private components: IBotComponents
  private store: IKeyValueStore

  constructor (components: CommanderOpts) {
    this.components = components

    const {
      bot,
      productsAPI,
      employeeManager,
      applications,
      friends,
      deployment,
      conf,
      logger,
      store
    } = components

    this.bot = bot
    this.productsAPI = productsAPI
    this.employeeManager = employeeManager
    this.applications = applications
    this.friends = friends
    this.conf = conf
    this.logger = logger
    this.deployment = deployment
    this.store = store
  }

  public getAvailableCommands = (ctx: ICommandContext) => {
    const { sudo, employee } = ctx
    if (sudo) return COMMANDS
    if (employee) return EMPLOYEE_COMMANDS
    return CUSTOMER_COMMANDS
  }

  public getCommandByName = (commandName:string):ICommand => {
    let lower = commandName.toLowerCase()
    let command
    try {
      command = commands[lower]
      if (!command) {
        const name = Object.keys(commands).find(key => commands[key].name === lower)
        command = name && commands[name]
      }
    } catch (err) {}

    if (!command) {
      throw new Errors.NotFound(`command not found: ${commandName}`)
    }

    return command
  }

  public execFromString = async (opts: ICommandInput):Promise<ICommandOutput> => {
    const ctx = this._createCommandContext(opts)
    const ret:ICommandOutput = { ctx }
    try {
      ret.result = await this._exec(ctx)
    } catch (err) {
      this.logger.debug(`failed to process command: ${ctx.commandName}`, err.stack)
      ret.error = err
    }

    return ret
  }

  private _exec = async (ctx: ICommandContext) => {
    const { commandName, argsStr } = ctx
    this.logger.debug(`processing command: ${commandName}`)
    this.ensureAuthorized(ctx)
    const command = ctx.command = this.getCommandByName(commandName)
    ctx.args = command.parse
      ? command.parse(argsStr, command.parseOpts)
      : parse(argsStr, command.parseOpts)

    ctx.ctx = ctx
    return await command.exec(ctx)
  }

  public exec = async (opts: IExecOpts) => {
    this._ensureCommandExists(opts)
    // TODO: auth, whitelist of functions allowed
    const { component, method, params, req } = opts
    return await this.components[component][method](params)
  }

  public sendResult = async ({ req, to, result }) => {
    // const message = typeof result === 'string' ? result : json2yaml(result)
    if (!result) return

    const message = typeof result === 'string' ? result : prettify(result)
    await this.sendSimpleMessage({ req, to, message })
  }

  public send = async (opts) => {
    return await this.productsAPI.send(opts)
  }

  public sendSimpleMessage = async ({ req, to, message }: {
    req?: any,
    to: any
    message: string
  }) => {
    return await this.send({
      req,
      to: to || req.user,
      object: {
        [TYPE]: 'tradle.SimpleMessage',
        message
      }
    })
  }

  public hasCommand = (ctx:ICommandContext):boolean => {
    return this.getAvailableCommands(ctx).includes(ctx.commandName)
  }

  public ensureHasCommand = (ctx:ICommandContext) => {
    if (this.hasCommand(ctx)) return

    if (ctx.employee && this.hasCommand({ ...ctx, sudo: true })) {
      throw new Errors.Forbidden(FORBIDDEN_MESSAGE)
    }

    throw new Errors.NotFound(NOT_FOUND_MESSAGE)
  }

  public defer = async (opts: IDeferredCommandParams):Promise<string> => {
    const { command, extra, ttl, dateExpires } = opts

    this._ensureCommandExists(command)
    if (!(ttl || dateExpires)) {
      throw new Errors.InvalidInput('expected "ttl" or "dateExpires')
    }

    const code = genConfirmationCode()
    const dateCreated = Date.now()
    await this.store.put(code, {
      command,
      extra,
      dateCreated,
      dateExpires: dateExpires || (dateCreated + ttl * 1000)
    })

    return code
  }

  // public defer = async (opts: IDeferredCommandInput):Promise<string> => {
  //   const { command, ttl, dateExpires, extra={} } = opts
  //   if (!(ttl || dateExpires)) {
  //     throw new Errors.InvalidInput('expected "ttl" or "dateExpires')
  //   }

  //   const ctx = this._createCommandContext(opts)
  //   this.ensureAuthorized(ctx)
  //   const code = genConfirmationCode(command)
  //   const dateCreated = Date.now()
  //   await this.store.put(code, {
  //     command,
  //     dateCreated,
  //     dateExpires: dateExpires || (dateCreated + ttl * 1000),
  //     extra
  //   })

  //   return code
  // }

  public execDeferred = async (code: string):Promise<ICommandOutput1> => {
    let state
    try {
      state = await this.store.get(code) as IConfirmationState
    } catch (error) {
      Errors.ignoreNotFound(error)
      return { error }
    }

    const {
      confirmed,
      dateExpires,
      command,
      extra
    } = state

    const ret:ICommandOutput1 = { command, extra }
    if (confirmed) {
      // Exists might not be the right error
      ret.error = new Errors.Exists(`confirmation code has already been used: ${code}`)
      return ret
    }

    if (Date.now() > dateExpires) {
      ret.error = new Errors.Expired(`confirmation code expired: ${code}`)
      return ret
    }

    // authorization is checked on defer()
    // const res = await this.exec({ confirmed: true, sudo: true, command: state.command })
    const res = await this.exec(command)
    await this.store.put(code, {
      ...state,
      confirmed: true
    })

    return {
      ...res,
      ...ret
    }
  }

  private _createCommandContext = (opts:ICommandInput):ICommandContext => {
    let { req } = opts
    if (!req) req = this.productsAPI.state.newRequestState({})

    const { command, sudo } = opts
    const { user } = req
    const { commandName, argsStr } = preParseCommand(command)
    return {
      commander: this,
      commandName,
      commandString: command,
      argsStr,
      sudo,
      req
    }
  }

  private ensureAuthorized = (ctx:ICommandContext) => {
    const { req, commandName } = ctx
    const { user } = req
    if (user) {
      ctx.employee = this.employeeManager.isEmployee(user)
    }

    this.ensureHasCommand(ctx)
  }

  private _ensureCommandExists = ({ component, method, params }: ICommandParams) => {
    const c = this.components[component]
    if (!c) throw new Errors.InvalidInput(`component not found: ${c}`)
    if (!c[method]) throw new Errors.InvalidInput(`component has no method: ${method}`)
  }
}

const preParseCommand = (command: string) => {
  const match = command.match(COMMAND_REGEX)
  if (!match) {
    throw new Error(`received malformed command: ${command}`)
  }

  const [commandName, argsStr=''] = match.slice(1)
  return { commandName, argsStr }
}

const genConfirmationCode = () => randomString(32)
