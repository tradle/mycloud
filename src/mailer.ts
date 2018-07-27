
/**
 * AWS Mailer
 */

import _ from 'lodash'
import { SES } from 'aws-sdk'
import Errors from './errors'
import {
  Logger,
  IMailer,
  IMailerSendEmailOpts,
  IMailerSendEmailResult
} from './types'

type AWSMailerOpts = {
  logger: Logger
  client: AWS.SES
}

// see: https://docs.aws.amazon.com/general/latest/gr/rande.html
const REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
]

const toArray = val => val ? [].concat(val) : []

export const interpetSendOpts = (opts: IMailerSendEmailOpts): SES.SendEmailRequest => {
  const body = { Data: opts.body }
  const req:SES.SendEmailRequest = {
    Source: opts.from,
    Destination: {
      ToAddresses: toArray(opts.to),
      CcAddresses: toArray(opts.cc),
      BccAddresses: toArray(opts.bcc)
    },
    Message: {
      Subject: { Data: opts.subject },
      Body: opts.format === 'text' ? { Text: body  } : { Html: body }
    }
  }

  if (opts.replyTo) {
    req.ReplyToAddresses = toArray(opts.replyTo)
  }

  return req
}

export default class Mailer implements IMailer {
  private client: SES
  private logger: Logger
  constructor({ client, logger }: AWSMailerOpts) {
    this.client = client
    this.logger = logger
  }

  public send = async (opts: IMailerSendEmailOpts):Promise<IMailerSendEmailResult> => {
    this.logger.debug('sending email', _.omit(opts, 'body'))
    const res = await this.client.sendEmail(interpetSendOpts(opts)).promise()
    return {
      id: res.MessageId
    }
  }

  public canSendFrom = async (address: string) => {
    const { region } = this.client.config
    if (region && !REGIONS.includes(region)) {
      return {
        result: false,
        reason: `Simple Email Service is not supported in region ${region}!`
      }
    }

    let res
    try {
      res = await this.client.getIdentityVerificationAttributes({
        Identities: [address]
      }).promise()
    } catch (err) {
      this.logger.debug('error checking send capability', err)
      Errors.rethrow(err, 'developer')
      return {
        result: false,
        reason: err.message
      }
    }

    const atts = res.VerificationAttributes[address]
    if (atts && atts.VerificationStatus === 'Success') {
      return {
        result: true
      }
    }

    return {
      result: false,
      reason: `cannot send emails from "${address}". Check your AWS Account controlled addresses at: https://console.aws.amazon.com/ses/home`
    }
  }
}

export { Mailer }
