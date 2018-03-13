import { Commander, DEFAULT_ERROR_MESSAGE } from '../commander'
import { Conf } from '../configure'
import { CreatePlugin, IPluginExports, CommandOutput, IPBReq } from '../types'
import { EmailBasedVerifier } from '../email-based-verifier'

export const name = 'commands'
export const createPlugin:CreatePlugin<EmailBasedVerifier> = ({ bot, commands }, { logger, conf }) => {
  const ebv = new EmailBasedVerifier({
    bot,
    commands,
    senderEmail: conf.senderEmail
  })

  const plugin = {}
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
