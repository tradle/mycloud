import { parse as parseUrl } from 'url'
import querystring from 'querystring'
import {
  Bot,
  IMailer,
  KeyValueTable,
  Commander,
  CommandOutput,
  IDeferredCommandInput,
  ISendEmailOpts
} from './types'

import * as Templates from './templates'
import Errors from '../errors'

type EmailBasedVerifierOpts = {
  bot: Bot
  senderEmail: string
  commands: Commander
}

interface IEmailVerificationOpts extends ISendEmailOpts {
  emailAddress: string
  senderEmail?: string // allow override 'from' address
  templateName: string
  dataTemplate: any
  data: any
}

export class EmailBasedVerifier {
  private bot: Bot
  private mailer: IMailer
  private commands: Commander
  private senderEmail: string
  constructor({ bot, commands, senderEmail }: EmailBasedVerifierOpts) {
    this.bot = bot
    this.mailer = bot.mailer
    this.commands = commands
    this.senderEmail = senderEmail
  }

  public execPendingEmailVerification = async (
    cmd: IDeferredCommandInput,
    emailOpts: IEmailVerificationOpts
  ) => {
    const code = await this.commands.defer(cmd)
    const url = this.genVerificationUrl(code)
    const body = Templates.email.action({
      blocks: [
        { body: 'Hi there,' },
        { body: '' },
        { body: `Note: You will be shown a form with a field "Stack Name". Don't edit it as it will break your template.` },
        {
          action: {
            text: 'Confirm Something Button Text',
            href: url
          }
        }
      ]
    })

    await this.mailer.send({
      subject: 'Confirm Something Subject',
      from: emailOpts.senderEmail || this.senderEmail,
      to: emailOpts.emailAddress,
      body,
      format: 'html',
    })
  }

  public processConfirmationCode = async (code: string) => {
    const res = await this.commands.execDeferred(code)
    if (res.error) {
      return {
        success: false,
        html: this.genErrorPage(res)
      }
    }

    return {
      success: true,
      html: this.genConfirmationPage(res)
    }
  }

  public genConfirmationPage = ({ result }: CommandOutput) => {
    return Templates.page.confirmation({
      title: 'Confirmed!',
      blocks: [
        { body: 'Whatever you were confirming was confirmed' },
        { body: 'Continue in your Tradle app' },
      ]
    })
  }

  public genErrorPage = (opts: CommandOutput) => {
    const { error } = opts
    if (Errors.matches(error, Errors.Exists)) {
      return this.genConfirmationPage(opts)
    }

    return Templates.page.confirmation({
      title: 'Oops!',
      blocks: [
        { body: 'Huh, a paradox...this page does not exist' }
      ]
    })
  }

  private genVerificationUrl = code => {
    const qs = querystring.stringify({ code })
    return `${this.bot.apiBaseUrl}/confirmation?${qs}`
  }
}
