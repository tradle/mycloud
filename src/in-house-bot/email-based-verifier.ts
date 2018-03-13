import querystring from 'querystring'
import _ from 'lodash'
import {
  Bot,
  IMailer,
  KeyValueTable,
  Commander,
  IDeferredCommandInput,
  IDeferredCommandOutput,
  ISendEmailOpts,
  IConf,
  Logger
} from './types'

import * as Templates from './templates'
import Errors from '../errors'

type EmailBasedVerifierOpts = {
  bot: Bot
  commands: Commander
  orgConf: IConf
  logger: Logger
  senderEmail: string
}

interface IConfirmationPageOpts {
  title: string
  body: string
}

interface IVerificationEmailOpts {
  emailAddress: string
  senderEmail?: string // allow override 'from' address
  // templateName?: string
  subject: string
  confirmationText: string
  warning?: string
  buttonText: string
  signature?: string
}

interface IEmailVerificationOpts {
  email: IVerificationEmailOpts
  confirmationPage: IConfirmationPageOpts
}

const DEFAULT_EMAIL_DATA = {
  warning: `If you believe you received this email in error, do NOT click below!`
}

const DATA_TEMPLATE = {
  blocks: [
    { body: 'Hi there,' },
    { body: `{{confirmationText}}` },
    { body: `{{warning}}` },
    {
      action: {
        text: '{{buttonText}}',
        href: '{{confirmationUrl}}'
      }
    }
  ],
  signature: '{{fromOrg.name}} Team',
}

export class EmailBasedVerifier {
  private bot: Bot
  private mailer: IMailer
  private commands: Commander
  private orgConf: IConf
  private logger: Logger
  private senderEmail: string
  constructor({ bot, commands, orgConf, logger, senderEmail }: EmailBasedVerifierOpts) {
    this.bot = bot
    this.mailer = bot.mailer
    this.commands = commands
    this.orgConf = orgConf
    this.logger = logger
    this.senderEmail = senderEmail
  }

  public confirmAndExec = async (
    cmd: IDeferredCommandInput,
    emailOpts: IEmailVerificationOpts
  ) => {
    const {
      senderEmail=this.senderEmail,
      // templateName='action',
      subject,
      emailAddress
    } = emailOpts.email

    const code = await this.commands.defer({
      ...cmd,
      extra: {
        confirmationPage: emailOpts.confirmationPage
      }
    })

    const confirmationUrl = this.genVerificationUrl(code)
    const dataValues = _.extend(
      { fromOrg: this.orgConf.org },
      DEFAULT_EMAIL_DATA,
      emailOpts,
      { confirmationUrl }
    )

    const data = Templates.renderData(DATA_TEMPLATE, dataValues)
    const body = Templates.email.action(data)
    this.logger.debug('sending email to confirm command', {
      command: cmd
    })

    await this.mailer.send({
      subject,
      from: senderEmail,
      to: emailAddress,
      body,
      format: 'html',
    })

    return code
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

  public genConfirmationPage = ({ result, extra }: IDeferredCommandOutput) => {
    const confirmationPage: IConfirmationPageOpts = extra.confirmationPage
    return Templates.page.confirmation({
      title: confirmationPage.title,
      blocks: confirmationPage.body
        .split('\n')
        .filter(str => str.trim().length)
        .map(body => ({ body }))
    })

    // return Templates.page.confirmation({
    //   title: 'Confirmed!',
    //   blocks: [
    //     { body: 'Whatever you were confirming was confirmed' },
    //     { body: 'Continue in your Tradle app' },
    //   ]
    // })
  }

  public genErrorPage = (opts: IDeferredCommandOutput) => {
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

  public genVerificationUrl = code => {
    const qs = querystring.stringify({ code })
    return `${this.bot.apiBaseUrl}/confirmation?${qs}`
  }
}
