
import { omit } from 'lodash'
import dotProp = require('dot-prop')
import { TYPE } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import { createBot, Bot } from '../bot'
import { Conf } from './configure'
import Errors = require('../errors')
import Logger from '../logger'
import { RESOLVED_PROMISE } from '../utils'

export class Init {
  private bot: Bot
  private forceRecreateIdentity: boolean
  private conf: any
  private confManager: Conf
  private logger: Logger
  constructor({ bot }) {
    this.bot = bot
    this.logger = bot.logger
    this.confManager = new Conf({ bot })
  }

  public getConf = async () => {
    return this.confManager.get()
  }

  public ensureInitialized = async (conf) => {
    try {
      await this.bot.getMyIdentity()
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      await this.init(conf)
    }
  }

  public init = async (conf) => {
    await this.confManager.init(conf)
  }

  public update = async (conf) => {
    await this.confManager.update(conf)
  }
}
