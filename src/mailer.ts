/**
 * AWS Mailer
 */

import _ from 'lodash'
import { SES } from 'aws-sdk'
import Errors from './errors'
import { Logger, IMailer, IMailerSendEmailOpts, IMailerSendEmailResult } from './types'

type AWSMailerOpts = {
  logger: Logger
  client: AWS.SES
}

// see: https://docs.aws.amazon.com/general/latest/gr/rande.html
export const REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-east-2',
  'ap-south-1',
  'ap-southeast-2',
  'eu-central-1',
  'eu-central-2',
  'me-south-1',
  'ap-east-1',
  'ap-southeast-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ca-central-1',
  'cn-north-1',
  'cn-northwest-1',
  'eu-north-1',
  'sa-east-1',
  ]



const toArray = val => (val ? [].concat(val) : [])

export const validateSendOpts = (opts: IMailerSendEmailOpts) => {
  const { subject } = opts
  if (/[\r\n]/.test(subject)) {
    throw new Errors.InvalidInput(`email subject cannot include line breaks: ${subject}`)
  }
}

export const interpetSendOpts = (opts: IMailerSendEmailOpts): SES.SendEmailRequest => {
  const body = { Data: opts.body }
  const req: SES.SendEmailRequest = {
    Source: opts.from,
    Destination: {
      ToAddresses: toArray(opts.to),
      CcAddresses: toArray(opts.cc),
      BccAddresses: toArray(opts.bcc)
    },
    Message: {
      Subject: { Data: opts.subject },
      Body: opts.format === 'text' ? { Text: body } : { Html: body }
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

  public send = async (opts: IMailerSendEmailOpts): Promise<IMailerSendEmailResult> => {
    validateSendOpts(opts)
    this.logger.debug('sending email', _.omit(opts, 'body'))
    let interp = interpetSendOpts(opts)

    let { region, endpoint } = this.client.config
    this.logger.debug(`AWS_REGION: ${region}; AWS_ENDPOINT: ${endpoint}`)

    const res = await this.client.sendEmail(interp).promise()
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
      res = await this.client
        .getIdentityVerificationAttributes({
          Identities: [address]
        })
        .promise()
    } catch (err) {
      this.logger.debug('error checking send capability', err)
      Errors.rethrow(err, 'developer')
      return {
        result: false,
        reason: err.message || `failed to check if ${address} is verified as a sender email`
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
