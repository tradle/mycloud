import { TYPE, TYPES } from '@tradle/constants'
import cloneDeep from 'lodash/cloneDeep'
import validateResource from '@tradle/validate-resource'
// @ts-ignore
const { sanitize } = validateResource.utils
import { Bot, Logger, Applications } from '../types'
import { getEnumValueId } from '../utils'
import { normalizeEnumForPrefill, getAllToExecute } from '../setProps-utils'

const CONTRACT_SIGNING = 'tradle.ContractSigning'
const FORM_ERROR = 'tradle.FormError'
const APPLICATION = 'tradle.Application'
const FORM_REQUEST = 'tradle.FormRequest'
const DAY = 24 * 60 * 60000
const MONTH = 30 * DAY

const MAX_TERM = 48
export class ContractChaser {
  private bot: Bot
  private applications: Applications
  private logger: Logger
  private conf: any

  constructor(bot: Bot, applications: Applications, conf) {
    this.bot = bot
    this.applications = applications
    this.logger = bot.logger
    this.conf = conf
  }
  public async chase() {
    // debugger
    let eqClause = {
      [TYPE]: CONTRACT_SIGNING
    }
    let date = new Date()
    date.setHours(24,0,0,0)
    let { items } = await this.bot.db.find({
      allowScan: true,
      orderBy: {
        property: '_time',
        desc: true
      },
      filter: {
        EQ: eqClause,
        GT: {
          firstScheduledPaymentDue: date.getTime() - MAX_TERM * MONTH
        }
      }
    })
    if (!items.length) return
    // Filter out the 
    items = items.filter(item => {
      let { term } = item
      if (!term) return false
      let firstSched = new Date(item.firstScheduledPaymentDue)
      firstSched.setHours(24, 0, 0, 0)
      try {
        // Too early to request
        if (firstSched.getTime() > date.getTime()) return false
        // just right for the first payment
        if (firstSched.getTime() === date.getTime()) return true

        let numberOfSentRequests = Math.floor((date.getTime() - firstSched.getTime()) / MONTH)
        // This contract was fulfilled (include the first payment)
        if (term === numberOfSentRequests + 1) return false

        // Too early for the next request
        let timeToSendRequest = (date.getTime() - firstSched.getTime()) % MONTH
        if (timeToSendRequest > 1)
          return false

        return true
      } catch (err) {
        return false
      }
    })

    if (!items.length) return

    // For now let's assume we have only one type of applications with ContractSigning
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
      let application
      try {
        application = await this.bot.db.findOne({
          filter: {
            EQ: {
              [TYPE]: APPLICATION,
              context: msgs[i].context
            }
          }
        })
        if (!application) continue
        let requestFor = application.requestFor
        let { form, settings, message } = this.conf[requestFor]
        let prefill
        if (settings) {
          application = await this.bot.getResource(application, {backlinks: ['forms']})
          prefill = await this.handleSettings(application)
          // Calculate settings
        }
        else {
          prefill = {
            [TYPE]: form
          }  
        }
        await this.applications.requestEdit({
          application,
          applicant: application.applicant,
          details: {
            prefill,
            message: message || `Time to pay`
          }
        })
      } catch (err) {
        debugger
      }
    }
  }
  async handleSettings(application) {
    debugger
    const { form, settings, moreSettings, additionalFormsFromProps } = this.conf[application.requestFor]
    const { models } = this.bot
    let prefill = { [TYPE]: form }
    let allSettings = cloneDeep(settings)
    if (moreSettings  &&  moreSettings.monthlyPayment)
      allSettings.push(moreSettings.monthlyPayment)
    const { bot, logger } = this
    let { allForms, allFormulas = [], forms } = await getAllToExecute({
      application,
      settings: allSettings,
      model: models[form],
      bot,
      logger,
      additionalFormsFromProps
    })
    let allSet = true
    allFormulas.forEach(async val => {
      let [propName, formula] = val
      try {
        let value = new Function('forms', 'application', `return ${formula}`)(forms, application)
        prefill[propName] = value
      } catch (err) {
        allSet = false
        debugger
      }
    })
    prefill = sanitize(prefill).sanitized
    normalizeEnumForPrefill({ form: prefill, model: models[form], models })
    return prefill
  }
}
