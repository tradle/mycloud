import _ from 'lodash'
import Errors from '../errors'
import * as Templates from './templates'
import { appLinks } from '../app-links'

interface ConfirmationEmailTemplateData {
  name: string
  mobileUrl: string
  webUrl: string
  orgName?: string
}
interface GenConfirmationEmailOpts {
  provider: string
  host: string
  name: string
  orgName?: string
  message: string
  extraQueryParams?: any
  template: any
  product: string
  senderEmail: string
}
export const sendConfirmationEmail = async ({
  emailAddress,
  payload,
  bot,
  product,
  subject,
  orgName = '',
  name,
  senderEmail,
  extraQueryParams = {},
  message,
  template
}) => {
  bot.logger.debug('preparing to send invite') // to ${emailAddress} from ${this.conf.senderEmail}`)

  const host = bot.apiBaseUrl
  const provider = await bot.getMyPermalink()

  const body = genConfirmationEmail({
    provider,
    host,
    name,
    orgName,
    extraQueryParams,
    template,
    message,
    product,
    senderEmail
  })

  debugger
  try {
    await bot.mailer.send({
      from: senderEmail,
      to: [emailAddress],
      format: 'html',
      subject,
      body
    })
  } catch (err) {
    Errors.rethrow(err, 'developer')
    this.logger.error('failed to email', err)
  }
}

export const renderConfirmationEmail = (template, data: ConfirmationEmailTemplateData) =>
  Templates.email.action(Templates.renderData(template, data))

export const genConfirmationEmail = ({
  provider,
  host,
  name,
  orgName,
  product,
  message,
  template,
  extraQueryParams = {}
}: GenConfirmationEmailOpts) => {
  const [mobileUrl, webUrl] = ['mobile', 'web'].map(platform => {
    return appLinks.getApplyForProductLink({
      provider,
      host,
      product,
      platform,
      message,
      ...extraQueryParams
    })
  })

  return renderConfirmationEmail(template, { name, mobileUrl, webUrl, orgName })
}
