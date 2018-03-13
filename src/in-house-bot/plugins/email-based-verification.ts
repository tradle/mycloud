import { TYPE } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { Commander, DEFAULT_ERROR_MESSAGE } from '../commander'
import { Conf } from '../configure'
import { CreatePlugin, ITradleObject, IPBReq } from '../types'
import { EmailBasedVerifier } from '../email-based-verifier'

const EMAIL_CHECK = 'tradle.EmailCheck'
const BUSINESS_INFORMATION = 'tradle.BusinessInformation'
const CONFIRMATION_PAGE_TEXT = `Your email address have been confirmed

Please continue in the Tradle app`

const EMAIL_PROP = {
  'tradle.BusinessInformation': 'companyEmail',
  'tradle.PersonalInfo': 'emailAddress'
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

  const getEmailValue = (form: ITradleObject) => {
    if (form[TYPE] in EMAIL_PROP) {
      return form[EMAIL_PROP[form[TYPE]]]
    }
  }

  const plugin = {
    ['onmessage:tradle.Form']: async (req) => {
      const { application, payload } = req
      const emailAddress = getEmailValue(payload)
      if (!emailAddress) return

      logger.debug(`created ${EMAIL_CHECK}`, {
        emailAddress
      })

      const check = await applications.createCheck({
        req,
        props: {
          [TYPE]: EMAIL_CHECK,
          application,
          emailAddress,
          // this org
          provider: conf.org.name
        }
      })

      await ebv.confirmAndExec({
        deferredCommand: {
          ttl: 3600, // 1 hr
          command: {
            component: 'applications',
            method: 'updateCheck',
            params: {
              type: EMAIL_CHECK,
              permalink: check._permalink,
              props: {
                status: 'pass'
              }
            }
          }
        },
        confirmationEmail: {
          subject: 'Confirm email address',
          emailAddress,
          confirmationText: 'Please click below to confirm your corporate email',
          buttonText: 'Confirm Email'
        },
        confirmationPage: {
          title: 'Email Confirmed!',
          body: CONFIRMATION_PAGE_TEXT
        }
      })
    }
  }

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
