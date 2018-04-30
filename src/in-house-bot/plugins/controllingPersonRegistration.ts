import fetch from 'node-fetch'
import _ from 'lodash'

import * as utils from '../utils'
import { Bot, Logger, CreatePlugin, Applications } from '../types'
import * as Templates from '../templates'
import Errors from '../../errors'

const FORM_ID = 'tradle.PersonalInfo'
const ONBOARD_MESSAGE = 'Controlling person onboarding'
const DEFAULT_TEMPLATE = {
  template: 'action',
  blocks: [
    { body: 'Hello {{name}}', },
    { body: 'Click below to complete your onboarding' },
    { body: '<a href="{{employeeOnboarding}}">this link</a>' },
  ],
  signature: '{{orgName}} Team',
}

interface IControllingPersonConf {
  senderEmail: string
}

class ControllingPersonRegistrationAPI {
  private bot:Bot
  private logger:Logger
  private org: any
  private conf: IControllingPersonConf
  constructor({ bot, org, conf, logger }) {
    this.bot = bot
    this.org = org
    this.conf = conf
    this.logger = logger
  }
  async _send(resource, application) {
    let emailAddress = resource.emailAddress

    let permalink = await this.bot.getPermalink()
    let values = utils.getAppLinks({bot: this.bot, permalink})
    _.extend(values, {name: resource.firstName, orgName: this.org.name})
    let body = Templates.email.action(Templates.renderData(DEFAULT_TEMPLATE, values))
debugger
    try {
      await this.bot.mailer.send({
        from: this.conf.senderEmail,
        to: [emailAddress],
        format: 'html',
        subject: ONBOARD_MESSAGE,
        body
      })
    } catch (err) {
      Errors.rethrow(err, 'developer')
      this.logger.error('failed to email controlling person', err)
    }
  }
}

export const createPlugin: CreatePlugin<void> = (components, { logger, conf }) => {
  const { bot } = components
  const orgConf = components.conf
  const { org } = orgConf
  const cp = new ControllingPersonRegistrationAPI({ bot, conf, org, logger })
  const plugin = {
    [`onmessage:${FORM_ID}`]: async function(req) {
      const { user, application, payload } = req
      if (!application) return
debugger
      let productId = application.requestFor
      let { products } = conf
      if (!products  ||  !products[productId]  ||  products[productId].indexOf(FORM_ID) === -1)
        return

      if (!payload.emailAddress)
        return
      if (payload._prevlink) {
        let prevR = await bot.objects.get(payload._prevlink)
        if (prevR  &&  prevR.emailAddress === payload.emailAddress)
          return
      }
      cp._send(payload, application)
    }
  }

  return {
    plugin
  }
}
