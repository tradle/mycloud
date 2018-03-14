import { TYPE } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { Commander, DEFAULT_ERROR_MESSAGE } from '../commander'
import { Conf } from '../configure'
import { CreatePlugin, ITradleObject, IPBReq } from '../types'
import { EmailBasedVerifier } from '../email-based-verifier'
import { getPropertyTitle, getEnumValueId } from '../utils'

const EMAIL_CHECK = 'tradle.EmailCheck'
const BUSINESS_INFORMATION = 'tradle.BusinessInformation'
const CONFIRMATION_PAGE_TEXT = `Your email address have been confirmed

Please continue in the Tradle app`

const EXPIRED_PAGE_TEXT = `This confirmation link has expired!

Please request another`

const EMAIL_PROP = {
  'tradle.BusinessInformation': {
    property: 'companyEmail',
    corporate: true
  },
  'tradle.PersonalInfo': {
    property: 'emailAddress'
  }
}

export const name = 'email-based-verification'
export const createPlugin:CreatePlugin<EmailBasedVerifier> = ({
  bot,
  commands,
  conf,
  applications
}, pluginOpts) => {
  const { logger } = pluginOpts
  const pluginConf = pluginOpts.conf
  const ebv = new EmailBasedVerifier({
    bot,
    commands,
    orgConf: conf,
    logger: pluginOpts.logger,
    senderEmail: pluginConf.senderEmail
  })

  const getEmail = (form: ITradleObject) => {
    const pConf = EMAIL_PROP[form[TYPE]]
    if (!pConf) return

    const value = form[pConf.property]
    if (!value) return

    return { ...pConf, value }
  }

  const plugin = {
    validateForm: async ({ req, application, form }) => {
      const emailAddress = getEmail(form)
      if (!emailAddress) return

      const { property, value, corporate } = emailAddress
      const ok = corporate ? ebv.isCorporate(value) : !ebv.isDisposable(value)
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
    ['onmessage:tradle.Form']: async (req) => {
      const { application, payload } = req
      const emailAddress = getEmail(payload)
      if (!emailAddress) return

      const { property, value } = emailAddress
      logger.debug(`created ${EMAIL_CHECK}`, { emailAddress: value })
      await applications.createCheck({
        req,
        props: {
          [TYPE]: EMAIL_CHECK,
          application,
          emailAddress: value,
          // this org
          provider: conf.org.name
        }
      })
    }
  }

  bot.hookSimple('async:save', async (event) => {
    const { object } = event
    if (object[TYPE] !== EMAIL_CHECK) return
    if (object.status) return

    const botPermalink = await bot.getMyIdentityPermalink()
    if (object._author !== botPermalink) return

    await ebv.confirmAndExec({
      deferredCommand: {
        ttl: 3600, // 1 hr
        // ttl: 1, // 1 second
        command: {
          component: 'applications',
          method: 'updateCheck',
          params: {
            type: EMAIL_CHECK,
            permalink: object._permalink,
            props: {
              status: 'pass'
            }
          }
        }
      },
      confirmationEmail: {
        subject: 'Confirm email address',
        emailAddress: object.emailAddress,
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
    api: ebv,
    plugin
  }
}

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: any
}) => {
  const { senderEmail } = pluginConf
  if (!senderEmail) {
    throw new Error('expected "senderEmail"')
  }

  const canSend = await conf.bot.mailer.canSendFrom(senderEmail)
  if (!canSend) {
    throw new Error(`cannot send emails from "${senderEmail}".
Check your AWS Account controlled addresses at: https://console.aws.amazon.com/ses/home`)
  }
}
