import parse = require('minimist')
import { TYPE } from '@tradle/constants'
import {
  Command,
  ExecCommandFunction
} from './types'

import {
  help,
  listproducts,
  forgetme,
  enableproduct,
  disableproduct
} from './commands'

const COMMAND_REGEX = /^\/?([^\s]+)\s*(.*)?$/
const DEFAULT_ERROR_MESSAGE = `sorry, I don't understand. To see the list of supported commands, type: /help`
const EMPLOYEE_COMMANDS:Command[] = [
  help,
  listproducts,
  forgetme,
  enableproduct,
  disableproduct
]

const CUSTOMER_COMMANDS:Command[] = [
  help,
  listproducts,
  forgetme
]

type Args = {
  _: string[],
  [key: string]: any
}

export class Commander {
  private tradle:Tradle
  private bot:any
  private productsAPI:any
  private employeeManager:any
  private conf: any
  constructor ({ bot, productsAPI, employeeManager, conf }) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.employeeManager = employeeManager
    this.conf = conf
  }

  async exec({ req, command }) {
    const parts = command.match(COMMAND_REGEX)
    const isEmployee = this.employeeManager.isEmployee(req.user)
    const commands = isEmployee ? EMPLOYEE_COMMANDS : CUSTOMER_COMMANDS
    const matchingCommand = commands.find(({ name, disabled }) => {
      return !disabled && name === parts[1]
    })

    if (!matchingCommand) {
      const message = isEmployee
        ? `command not found: ${command}`
        : DEFAULT_ERROR_MESSAGE

      await this.sendSimpleMessage({ req, message })
      return
    }

    try {
      await matchingCommand.exec({
        context: this,
        req,
        command: parts[2] || ''
      })
    } catch (err) {
      this.bot.debug(`failed to process command: ${matchingCommand.name}`, err.stack)
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
