import parse = require('minimist')
import { TYPE } from '@tradle/constants'
import {
  Command,
  ExecCommandFunction
} from './types'

import * as commands from './commands'

// import {
//   help,
//   listProducts,
//   forgetMe,
//   setProductEnabled,
//   setAutoVerify,
//   setAutoApprove,
//   // setAutoPrompt
// } from './commands'

import {
  getAvailableCommands,
  getCommandByName
} from './utils'

import Logger from '../../logger'

const COMMAND_REGEX = /^\/?([^\s]+)\s*(.*)?$/
const DEFAULT_ERROR_MESSAGE = `sorry, I don't understand. To see the list of supported commands, type: /help`

type Args = {
  _: string[],
  [key: string]: any
}

type CommandContext = {
  commandName: string
  allowed?: boolean
  employee?: boolean
  sudo?: boolean
  argsStr: string
  [x:string]: any
}

const SUDO = {
  employee: true,
  allowed: true
}

export class Commander {
  private bot:any
  private productsAPI:any
  private employeeManager:any
  private conf: any
  private logger: Logger
  constructor ({ bot, productsAPI, employeeManager, conf }) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.employeeManager = employeeManager
    this.conf = conf
    this.logger = bot.logger.sub('cli')
  }

  private auth = async (ctx:CommandContext):Promise<void> => {
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
    const commandNames = getAvailableCommands(ctx)
    ctx.allowed = commandNames.includes(commandName)
    if (!ctx.allowed) {
      const message = ctx.employee
        ? `command not found: ${commandName}`
        : DEFAULT_ERROR_MESSAGE

      await this.sendSimpleMessage({ to: user, message })
    }
  }

  public exec = async ({ req, command, sudo=false }) => {
    this.logger.debug(`processing command: ${command}`)
    if (!req) req = this.productsAPI.state.newRequestState({})

    const { user } = req
    const [commandName, argsStr=''] = command.match(COMMAND_REGEX).slice(1)
    const ctx:CommandContext = {
      commandName,
      argsStr,
      sudo,
      allowed: sudo,
      req
    }

    await this.auth(ctx)
    if (!ctx.allowed) return

    try {
      const matchingCommand = getCommandByName(commandName)
      const args = matchingCommand.parse ? matchingCommand.parse(argsStr) : null
      await matchingCommand.exec({
        context: this,
        req,
        args
      })
    } catch (err) {
      this.logger.debug(`failed to process command: ${command}`, err.stack)
      if (user) {
        const message = ctx.employee
          ? err.message
          : DEFAULT_ERROR_MESSAGE

        await this.sendSimpleMessage({ req, to: user, message })
      }
    }
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
}
