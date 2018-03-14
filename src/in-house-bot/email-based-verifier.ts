import querystring from 'querystring'
import _ from 'lodash'
import {
  Bot,
  IMailer,
  KeyValueTable,
  Commander,
  ICommandOutput1,
  IDeferredCommandParams,
  // IDeferredCommandInput,
  // IDeferredCommandOutput,
  ISendEmailOpts,
  IConf,
  Logger
} from './types'

import * as Templates from './templates'
import Errors from '../errors'
import Validation from 'freemail'

const EMAIL_CHECK = 'tradle.EmailCheck'

type EmailBasedVerifierOpts = {
  bot: Bot
  commands: Commander
  orgConf: IConf
  logger: Logger
  senderEmail: string
}

interface IResultPageOpts {
  title: string
  body: string
  signature?: string
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
  confirmationPage: IResultPageOpts
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

  public confirmAndExec = async ({ deferredCommand, confirmationEmail, confirmationPage, expiredPage }: {
    deferredCommand: IDeferredCommandParams
    confirmationEmail: IVerificationEmailOpts
    confirmationPage: IResultPageOpts
    expiredPage?: IResultPageOpts
  }) => {
    const {
      senderEmail=this.senderEmail,
      subject,
      emailAddress
    } = confirmationEmail

    const code = await this.commands.defer({
      ...deferredCommand,
      extra: { confirmationPage, expiredPage }
    })

    const confirmationUrl = this.genVerificationUrl(code)
    const dataValues = _.extend(
      { fromOrg: this.orgConf.org },
      DEFAULT_EMAIL_DATA,
      confirmationEmail,
      { confirmationUrl }
    )

    const data = Templates.renderData(DATA_TEMPLATE, dataValues)
    const body = Templates.email.action(data)
    this.logger.debug('sending email to confirm command', { command: deferredCommand })
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

  public genConfirmationPage = ({ result, extra }: ICommandOutput1) => {
    const confirmationPage: IResultPageOpts = extra.confirmationPage
    return Templates.page.confirmation({
      title: confirmationPage.title,
      blocks: textToBlocks(confirmationPage.body),
      // signature: `-${this.orgConf.org.name} Team`
    })
  }

  public genErrorPage = (opts: ICommandOutput1) => {
    const { error, extra } = opts
    if (Errors.matches(error, Errors.Exists)) {
      return this.genConfirmationPage(opts)
    }

    this.logger.error('email based verification failed', { error })
    if (extra && extra.expiredPage && Errors.matches(error, Errors.Expired)) {
      const { expiredPage } = extra
      return Templates.page.confirmation({
        title: expiredPage.title,
        blocks: textToBlocks(expiredPage.body)
      })
    }

    return Templates.page.confirmation({
      title: 'Error',
      blocks: [
        { body: 'Huh, a paradox...this page does not exist' }
      ]
    })
  }

  public genVerificationUrl = code => {
    const qs = querystring.stringify({ code })
    return `${this.bot.apiBaseUrl}/confirmation?${qs}`
  }

  public isDisposable = (emailAddress: string) => Validation.isDisposable(emailAddress)
  public isFree = (emailAddress: string) => Validation.isFree(emailAddress)
  public isCorporate = (emailAddress: string) => {
    return !(this.isFree(emailAddress) || this.isDisposable(emailAddress))
  }
}

const textToBlocks = str => str
  .split('\n')
  .map(body => ({ body }))
