
/**
 * AWS Mailer
 */

import { SES } from 'aws-sdk'
import {
  AwsApis,
  IMailer,
  ISendEmailOpts,
  ISendEmailResult
} from './types'

type MailerOpts = {
  aws: AwsApis
}

const toArray = val => val ? [].concat(val) : []

export const interpetSendOpts = (opts: ISendEmailOpts): SES.SendEmailRequest => {
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
  private ses: SES
  constructor({ aws }: MailerOpts) {
    this.ses = aws.ses
  }

  public send = async (opts: ISendEmailOpts):Promise<ISendEmailResult> => {
    const res = await this.ses.sendEmail(interpetSendOpts(opts)).promise()
    return {
      id: res.MessageId
    }
  }

  public canSendFrom = async (address: string):Promise<boolean> => {
    const res = await this.ses.getIdentityVerificationAttributes({
      Identities: [address]
    }).promise()

    const atts = res.VerificationAttributes[address]
    return atts ? atts.VerificationStatus === 'Success' : false
  }
}

export { Mailer }
