import get from 'lodash/get'
import { TYPE } from '@tradle/constants'
import { Conf } from '../configure'
import {
  CreatePlugin,
  ITradleObject,
  IPBApp,
  IPluginOpts
} from '../types'
import { EmailBasedVerifier, TTL } from '../email-based-verifier'
import { getPropertyTitle } from '../utils'
import Errors from '../../errors'
import { topics as EventTopics } from '../../events'

const EMAIL_CHECK = 'tradle.EmailCheck'
const BUSINESS_INFORMATION = 'tradle.BusinessInformation'
const CONFIRMATION_PAGE_TEXT = `Your email address have been confirmed

Please continue in the Tradle app`

const EXPIRED_PAGE_TEXT = `This confirmation link has expired!

Please request another`

interface IEBVForm {
  property: string
  corporate?: boolean
}

interface IEBVProduct {
  [form: string]: IEBVForm
}

interface IEBVProducts {
  [product: string]: IEBVProduct
}

interface IEBVPluginConf {
  senderEmail: string
  products: IEBVProducts
}

interface IEBVPluginOpts extends IPluginOpts {
  conf: IEBVPluginConf
}

// interface IEBVPluginOpts extends IBotComponents {
//   logger: Logger
//   pluginConf: IEBVPluginConf
// }

// class EBVPlugin {
//   private bot: Bot
//   private commands: Commander
//   private ebv: EmailBasedVerifier
//   private applications: Applications
//   private conf: IEBVPluginConf
//   private logger: Logger
//   constructor({
//     bot,
//     commands,
//     emailBasedVerifier,
//     applications,
//     pluginConf,
//     logger
//   }: IEBVPluginOpts) {
//     this.bot = bot
//     this.commands = commands
//     this.ebv = emailBasedVerifier
//     this.applications = applications
//     this.conf = pluginConf
//     this.logger = logger
//   }
// }

export const name = 'email-based-verification'
export const createPlugin:CreatePlugin<EmailBasedVerifier> = ({
  bot,
  commands,
  emailBasedVerifier,
  conf,
  applications
}, pluginOpts: IEBVPluginOpts) => {
  const { logger } = pluginOpts
  const pluginConf = <IEBVPluginConf>pluginOpts.conf
  const { senderEmail, products } = pluginConf
  if (!emailBasedVerifier) {
    emailBasedVerifier = new EmailBasedVerifier({
      bot,
      commands,
      orgConf: conf,
      logger: pluginOpts.logger,
      senderEmail
    })
  }

  const getEmail = (application: IPBApp, form: ITradleObject) => {
    if (!application) return

    const pConf = <any>get(pluginConf.products, [application.requestFor, form[TYPE]])
    if (!pConf) return

    const value = form[pConf.property]
    if (!value) return

    return { ...pConf, value }
  }

  const shouldCreateCheck = async ({ user, emailAddress }) => {
    let latest
    try {
      latest = await emailBasedVerifier.getLatestCheck({ user, emailAddress })
    } catch (err) {
      Errors.ignoreNotFound(err)
      return true
    }

    return latest.failed || latest.errored || latest.expired
  }

  const plugin = {
    validateForm: async ({ req, application, form }) => {
      const emailAddress = getEmail(application, form)
      if (!emailAddress) return

      const { property, value, corporate } = emailAddress
      const ok = corporate
        ? emailBasedVerifier.isCorporate(value)
        : !emailBasedVerifier.isDisposable(value)

      if (ok) return

      const title = getPropertyTitle({
        model: bot.models[form[TYPE]],
        propertyName: property
      })

      const emailType = corporate ? 'corporate' : 'personal'
      return {
        message: `Please correct the field "${title}"`,
        errors: [{
          name: property,
          error: `Please provide your ${emailType} email`
        }]
      }
    },
    'onmessage:tradle.Form': async (req) => {
      const { user, application, payload } = req
      const emailAddress = getEmail(application, payload)
      if (!emailAddress) return

      const { property, value } = emailAddress
      const keepGoing = await shouldCreateCheck({
        user,
        emailAddress: value
      })

      if (!keepGoing) {
        logger.debug('not creating email check, already verified or pending', {
          user: user.id,
          emailAddress: value
        })

        return
      }

      logger.debug(`created ${EMAIL_CHECK}`, { emailAddress: value })
      const createCheck = applications.createCheck({
        [TYPE]: EMAIL_CHECK,
        application,
        emailAddress: value,
        // this org
        provider: conf.org.name,
        user: user.identity,
        dateExpires: Date.now() + TTL.ms
      })

      const alertUser = await bot.sendSimpleMessage({
        to: user,
        message: `Please check ${value} for a confirmation link`
      })

      await Promise.all([
        createCheck,
        alertUser
      ])
    }
  }

  bot.hookSimple(EventTopics.resource.save.async, async (event) => {
    const { value, old } = event
    if (!value) return // this is a 'delete' op
    if (value[TYPE] !== EMAIL_CHECK) return
    if (value.status) return

    const botPermalink = await bot.getPermalink()
    if (value._author !== botPermalink) return

    await emailBasedVerifier.confirmAndExec({
      deferredCommand: {
        dateExpires: value.dateExpires,
        // ttl: 1, // 1 second
        command: {
          component: 'applications',
          method: 'updateCheck',
          params: {
            type: EMAIL_CHECK,
            permalink: value._permalink,
            props: {
              status: 'pass'
            }
          }
        }
      },
      confirmationEmail: {
        subject: 'Confirm email address',
        emailAddress: value.emailAddress,
        confirmationText: 'Please click below to confirm your corporate email',
        buttonText: 'Confirm Email'
      },
      confirmationPage: {
        title: 'Email Confirmed!',
        body: CONFIRMATION_PAGE_TEXT
      },
      expiredPage: {
        title: 'Expired',
        body: EXPIRED_PAGE_TEXT
      }
    })
  })

  return {
    api: emailBasedVerifier,
    plugin
  }
}

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: IEBVPluginConf
}) => {
  const { senderEmail, products={} } = pluginConf
  if (!senderEmail) {
    throw new Error('expected "senderEmail"')
  }

  const resp = await conf.bot.mailer.canSendFrom(senderEmail)
  if (!resp.result) {
    throw new Error(resp.reason)
  }

  for (let product in products) {
    let pConf = products[product]
    for (let form in pConf) {
      let formModel = conf.bot.models[form]
      if (!formModel) {
        throw new Errors.InvalidInput(`model not found: ${form}`)
      }

      let fConf = pConf[form]
      let { property, corporate } = fConf
      if (!property) {
        throw new Errors.InvalidInput(`expected property name at products['${product}']['${form}'].property`)
      }

      if (!formModel.properties[property]) {
        throw new Errors.InvalidInput(`model ${form} has no property: ${property}`)
      }

      if (typeof corporate !== 'undefined' && typeof corporate !== 'boolean') {
        throw new Errors.InvalidInput(`expected boolean "corporate" at products['${product}']['${form}']`)
      }
    }
  }
}
