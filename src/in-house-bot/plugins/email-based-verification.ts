import { TYPE } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { Commander, DEFAULT_ERROR_MESSAGE } from '../commander'
import { Conf } from '../configure'
import { CreatePlugin, ITradleObject, IPBReq } from '../types'
import { EmailBasedVerifier } from '../email-based-verifier'

const EMAIL_CHECK = 'tradle.EmailCheck'

export const name = 'email-based-verification'
export const createPlugin:CreatePlugin<EmailBasedVerifier> = ({ bot, commands, conf }, pluginOpts) => {
  const pluginConf = pluginOpts.conf
  const ebv = new EmailBasedVerifier({
    bot,
    commands,
    orgConf: conf,
    logger: pluginOpts.logger,
    senderEmail: pluginConf.senderEmail
  })

  const getEmailProperty = (form:ITradleObject) => {
    if (form[TYPE] === 'tradle.BusinessInformation') {
      return form.companyEmail
    }
  }

  const getEmailValue = (form: ITradleObject) => {
    const prop = getEmailProperty(form)
    if (prop) return form[prop]
  }

  const plugin = {
    ['onmessage:tradle.Form']: async (req) => {
      const { application, payload } = req
      const emailAddress = getEmailValue(payload)
      if (!emailAddress) return

      const resource:any = {
        [TYPE]: EMAIL_CHECK,
        status,
        emailAddress,
        provider: conf.org.name,
        application: buildResource.stub({ resource: application, models: bot.models })
      }

      if (!application.checks) application.checks = []

      const check = await this.bot.signAndSave(resource)
      this.logger.debug(`created ${EMAIL_CHECK} for: ${emailAddress}`)
      application.checks.push(buildResource.stub({
        resource: check,
        models: bot.models
      }))
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
