import {
  Bot,
  Logger,
  IBotConf,
  Applications
} from '../types'

import _ from 'lodash'
import { TYPE } from '@tradle/constants'

import validateResource from '@tradle/validate-resource'

// @ts-ignore
const { sanitize } = validateResource.utils

const PENDING_WORK_TYPE = 'tradle.PendingWork'

const LAST_ATTEMPT = 'lastAttempt'
const FREQUENCY = 'frequency'

const PRODUCTS = 'products'
const PLUGINS = 'plugins'

export class PendingWorksHandler {
  private bot: Bot
  private logger: Logger
  private botConf: IBotConf
  private applications: Applications
  private trace: boolean

  constructor(bot: Bot, applications: Applications, botConf: IBotConf) {
    this.bot = bot
    this.logger = bot.logger
    this.botConf = botConf
    this.applications = applications
  }
  
  public chaseWorks = async () => {
    let works: any[] = await this.collectWork()
    this.logger.debug(`pendingWorkHandler found ${works.length} works to finish`)
    for (let work of works) {
      if (work[FREQUENCY] && work[LAST_ATTEMPT] + work[FREQUENCY] > Date.now())
        continue  
      // find plugin conf
      const conf = this.botConf[PRODUCTS][PLUGINS][work.plugin]
      this.logger.debug(`pendingWorkHandler work plugin conf: ${conf}`)
      const pluginModul = await import('../plugins/' + work.plugin)
      const { plugin } = pluginModul.createPlugin({ bot: this.bot, applications : this.applications },
                                                  { conf, logger: this.logger })
      this.logger.debug('pendingWorkHandler calling plugin replay')                                            
      await plugin.replay(work) 
    }
  }    
  
  public collectWork = async () => {
    let eqClause = {
      [TYPE]: PENDING_WORK_TYPE,
      done: false
    }
    const { items } = await this.bot.db.find({
      filter: {
        EQ: eqClause,
      },
      orderBy: {
        property: '_time',
        desc: true
      },
      limit: 10
    })
    return items
  }
}