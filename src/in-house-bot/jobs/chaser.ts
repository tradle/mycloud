import { TYPE } from '@tradle/constants'
import { Bot, Logger } from '../types'
import { getEnumValueId } from '../utils'

const NOTIFICATION = 'tradle.Notification'
const NOTIFICATION_STATUS = 'tradle.NotificationStatus'

const MINUTE = 60000

export class Chaser {
  private bot: Bot
  private logger: Logger

  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger
  }

  public async chase() {
    debugger
    let eqClause = {
      [TYPE]: NOTIFICATION
    }
    let notEqClause = {
      status: `${NOTIFICATION_STATUS}_completed`
    }
    let { items } = await this.bot.db.find({
      allowScan: true,
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: eqClause,
        NEQ: notEqClause
      }
    })
    if (!items.length) return
    let model = this.bot.models[NOTIFICATION_STATUS]
    items = items.filter(item => getEnumValueId({ model, value: item.status }) !== 'abandoned')
    // items.sort((a, b) => b._time - a._time)
    let now = Date.now()
    let notify = items.filter(
      item => now - item.dateLastNotified > (item.interval || 24 * 60 * MINUTE)
    )
    let result = await Promise.all(
      notify.map(item =>
        this.bot.versionAndSave({
          ...item
        })
      )
    )
  }
}
