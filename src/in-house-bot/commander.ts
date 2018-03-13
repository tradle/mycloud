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
  IDeferredCommandInput,
  ICommandOutput,
  IDeferredCommandOutput,
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
  command: string
  dateCreated: number
  dateExpires?: number
  ttl?: number // seconds
  confirmed?: boolean
  extra?: any
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
  'clear'
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

  public exec = async (opts: ICommandInput):Promise<ICommandOutput> => {
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

    return await command.exec(ctx)
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

  public defer = async (opts: IDeferredCommandInput):Promise<string> => {
    const { command, ttl, dateExpires, extra={} } = opts
    if (!(ttl || dateExpires)) {
      throw new Errors.InvalidInput('expected "ttl" or "dateExpires')
    }

    const ctx = this._createCommandContext(opts)
    this.ensureAuthorized(ctx)
    const code = genConfirmationCode(command)
    const dateCreated = Date.now()
    await this.store.put(code, {
      command,
      dateCreated,
      dateExpires: dateExpires || (dateCreated + ttl * 1000),
      extra
    })

    return code
  }

  public execDeferred = async (code: string):Promise<IDeferredCommandOutput> => {
    const state:IConfirmationState = await this.store.get(code)
    if (state.confirmed) {
      throw new Error(`confirmation code has already been used: ${code}`)
    }

    if (Date.now() > state.dateExpires) {
      throw new Errors.Expired(`confirmation code expired: ${code}`)
    }

    // authorization is checked on defer()
    const res = await this.exec({ confirmed: true, sudo: true, command: state.command })
    await this.store.put(code, {
      ...state,
      confirmed: true
    })

    return {
      ...res,
      extra: state.extra
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
}

const preParseCommand = (command: string) => {
  const match = command.match(COMMAND_REGEX)
  if (!match) {
    throw new Error(`received malformed command: ${command}`)
  }

  const [commandName, argsStr=''] = match.slice(1)
  return { commandName, argsStr }
}

const genConfirmationCode = (command: string) => randomString(20)
