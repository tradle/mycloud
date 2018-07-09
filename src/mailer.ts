
/**
 * AWS Mailer
 */

import _ from 'lodash'
import { SES } from 'aws-sdk'
import Errors from './errors'
import {
  AwsApis,
  Logger,
  IMailer,
  ISendEmailOpts,
  ISendEmailResult
} from './types'

type AWSMailerOpts = {
  logger: Logger
  client: AWS.SES
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
  private client: SES
  private logger: Logger
  constructor({ client, logger }: AWSMailerOpts) {
    this.client = client
    this.logger = logger
  }

  public send = async (opts: ISendEmailOpts):Promise<ISendEmailResult> => {
    this.logger.debug('sending email', _.omit(opts, 'body'))
    const res = await this.client.sendEmail(interpetSendOpts(opts)).promise()
    return {
      id: res.MessageId
    }
  }

  public canSendFrom = async (address: string):Promise<boolean> => {
    let res
    try {
      res = await this.client.getIdentityVerificationAttributes({
        Identities: [address]
      }).promise()
    } catch (err) {
      this.logger.debug('error checking send capability', err)
      Errors.rethrow(err, 'developer')
      return false
    }

    const atts = res.VerificationAttributes[address]
    return atts ? atts.VerificationStatus === 'Success' : false
  }
}

export { Mailer }
