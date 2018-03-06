import parse from 'yargs-parser'
import { TYPE } from '@tradle/constants'
import { Errors as ProductBotErrors } from '@tradle/bot-products'
import {
  IConf,
  ICommand,
  ICommandContext,
  CommandOutput,
  ICommandExecOpts,
  Bot,
  IBotComponents,
  Deployment
} from './types'

import { parseStub } from '../utils'
import Errors from '../errors'
import * as commands from './commands'
import Logger from '../logger'

const prettify = obj => JSON.stringify(obj, null, 2)
const COMMAND_REGEX = /^\/?([^\s]+)\s*(.*)?\s*$/
const DEFAULT_ERROR_MESSAGE = `sorry, I don't understand. To see the list of supported commands, type: /help`

const SUDO = {
  employee: true,
  allowed: true
}

interface ICommanderComponents extends IBotComponents {
  logger: Logger
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

export const COMMANDS = Object.keys(commands).map(key => commands[key].name || key)
export const SUDO_ONLY_COMMANDS = [
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

export class Commander {
  public bot: Bot
  public productsAPI:any
  public employeeManager:any
  public deployment?: Deployment
  public conf: IConf
  public logger: Logger
  private components: ICommanderComponents
  constructor (components: ICommanderComponents) {
    this.components = components

    const {
      bot,
      productsAPI,
      employeeManager,
      deployment,
      conf,
      logger
    } = components

    this.bot = bot
    this.productsAPI = productsAPI
    this.employeeManager = employeeManager
    this.conf = conf
    this.logger = logger
    this.deployment = deployment
  }

  private auth = async (ctx:ICommandContext):Promise<void> => {
    if (ctx.sudo) {
      ctx.allowed = true
      return
    }

    const { req, commandName } = ctx
    if (!req.user) {
      throw new Error(`cannot authenticate, don't know user`)
    }

    const { user } = req
    ctx.employee = this.employeeManager.isEmployee(user)
    const commandNames = this.getAvailableCommands(ctx)
    ctx.allowed = commandNames.includes(commandName)
    if (!ctx.allowed) {
      const message = ctx.employee
        ? `command not found: ${commandName}`
        : DEFAULT_ERROR_MESSAGE

      await this.sendSimpleMessage({ to: user, message })
    }
  }

  public getAvailableCommands = (ctx) => {
    if (ctx.sudo) return COMMANDS
    if (ctx.employee) return EMPLOYEE_COMMANDS
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

  public exec = async ({ req, command, sudo=false }):Promise<CommandOutput> => {
    const ret:CommandOutput = {}
    this.logger.debug(`processing command: ${command}`)
    if (!req) req = this.productsAPI.state.newRequestState({})

    const { user } = req
    const match = command.match(COMMAND_REGEX)
    if (!match) {
      throw new Error(`received malformed command: ${command}`)
    }

    const [commandName, argsStr=''] = match.slice(1)
    const ctx:ICommandContext = {
      commandName,
      argsStr,
      sudo,
      allowed: sudo,
      req
    }

    await this.auth(ctx)
    if (!ctx.allowed) return ret

    let result
    let matchingCommand:ICommand
    let args
    let execOpts:ICommandExecOpts
    try {
      matchingCommand = this.getCommandByName(commandName)
      args = matchingCommand.parse ? matchingCommand.parse(argsStr) : parse(argsStr)
      execOpts = {
        commander: this,
        req,
        args,
        argsStr,
        ctx
      }

      result = await matchingCommand.exec(execOpts)
    } catch (err) {
      this.logger.debug(`failed to process command: ${command}`, err.stack)
      let message
      if (ctx.sudo || ctx.employee) {
        message = err.name ? `${err.name}: ${err.message}` : err.message
      } else {
        message = DEFAULT_ERROR_MESSAGE
      }

      ret.error = { message }
      if (user) {
        await this.sendSimpleMessage({ req, to: user, message })
      }

      return ret
    }

    if (user) {
      const opts = {
        ...execOpts,
        to: user,
        result
      }

      if (matchingCommand.sendResult) {
        await matchingCommand.sendResult(opts)
      } else {
        await this.sendResult(opts)
      }
    }

    ret.result = result
    return ret
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

  public judgeApplication = async ({ req, application, approve }) => {
    const { bot, productsAPI } = this
    const judge = req && req.user
    application = await productsAPI.getApplication(application)
    const user = await bot.users.get(parseStub(application.applicant).permalink)
    const method = approve ? 'approveApplication' : 'denyApplication'
    try {
      await productsAPI[method]({ req, judge, user, application })
    } catch (err) {
      Errors.ignore(err, ProductBotErrors.Duplicate)
      throw new Error(`application already has status: ${application.status}`)
    }

    await productsAPI.saveNewVersionOfApplication({ user, application })
    await bot.users.merge(user)
  }
}
