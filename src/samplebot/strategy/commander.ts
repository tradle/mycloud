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

import Logger from '../../'

const COMMAND_REGEX = /^\/?([^\s]+)\s*(.*)?$/
const DEFAULT_ERROR_MESSAGE = `sorry, I don't understand. To see the list of supported commands, type: /help`

type Args = {
  _: string[],
  [key: string]: any
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

  async exec({ req, command }) {
    this.logger.debug(`processing command: ${command}`)
    const isEmployee = this.employeeManager.isEmployee(req.user)
    const [commandName, argsStr=''] = command.match(COMMAND_REGEX).slice(1)
    const commandNames = getAvailableCommands({ context: this, req })
    if (!commandNames.includes(commandName)) {
      const message = isEmployee
        ? `command not found: ${commandName}`
        : DEFAULT_ERROR_MESSAGE

      await this.sendSimpleMessage({ req, message })
      return
    }

    try {
      const matchingCommand = getCommandByName(commandName)
      await matchingCommand.exec({
        context: this,
        req,
        command: argsStr
      })
    } catch (err) {
      this.logger.debug(`failed to process command: ${command}`, err.stack)
      const message = isEmployee
        ? err.message
        : DEFAULT_ERROR_MESSAGE

      await this.sendSimpleMessage({ req, message })
    }
  }
  async sendSimpleMessage ({ req, to, message }: {
    req: any
    to?: any
    message: string
  }) {
    if (!to) to = req.user

    await this.productsAPI.send({
      req,
      to,
      object: {
        [TYPE]: 'tradle.SimpleMessage',
        message
      }
    })
  }
}
