import { TYPE } from '@tradle/constants'
import { Bot, Logger, Applications } from '../types'
import { getEnumValueId } from '../utils'

const CONTRACT_SIGNING = 'tradle.ContractSigning'
const FORM_ERROR = 'tradle.FormError'
const APPLICATION = 'tradle.Application'

export class ContractChaser {
  private bot: Bot
  private applications: Applications
  private logger: Logger

  constructor(bot: Bot, applications: Applications) {
    this.bot = bot
    this.applications = applications
    this.logger = bot.logger
  }

  public async chase() {
    // debugger
    let eqClause = {
      [TYPE]: CONTRACT_SIGNING
    }
    let { items } = await this.bot.db.find({
      allowScan: true,
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: eqClause
      }
    })
    if (!items.length) return
    let model = this.bot.models[CONTRACT_SIGNING]
    let date = new Date()
    date.setHours(24,0,0,0)

    items = items.filter(item => item.firstScheduledPaymentDue < date)
    if (!items.length) return
    let { items:formError } = await this.bot.db.find({
      allowScan: true,
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: {
          [TYPE]: FORM_ERROR,
          form___t: CONTRACT_SIGNING
        }
      }
    })
    if (formError.length) {
      items = items.filter(item => {
        for (let i=0; i<formError.length; i++) {
          if (item._permalink === formError[i].form._permalink) return false
        }
        return true
      })
    }
    let msgs
    try {
      msgs = await Promise.all(items.map(item => this.bot.getMessageWithPayload({
        select: ['object', 'context'],
        link: item._link,
        author: item._author,
        inbound: true
      })))
    } catch (err) {
      debugger
      this.logger.debug(`Messages were not found`)
      // return
    }
    if (!msgs.length) return

    for (let i=0; i<msgs.length; i++) {
      try {
        ({ items } = await this.bot.db.find({
          allowScan: true,
          orderBy: {
            property: '_time',
            desc: true
          },
          filter: {
            EQ: {
              [TYPE]: APPLICATION,
              context: msgs[i].context
            }
          }
        }))
        await this.applications.requestEdit({
          application: items[0],
          applicant: items[0].applicant,
          details: {
            prefill: {
               [TYPE]: CONTRACT_SIGNING,
               title: 'Hello'
            },
            message: `Time to pay`    
          }    
        })
      } catch (err) {
        debugger
      }
    }
  }
}
