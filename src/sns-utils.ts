
import acceptAll from 'lodash/stubTrue'
import isMatch from 'lodash/isMatch'
import { parseE164, getAWSRegionByCallingCode } from './geo'
import {
  AwsApis,
  Logger,
  SNSMessage,
  ISMS,
  ISendSMSOpts,
} from './types'

import {
  parseArn,
  genStatementId,
  pickNonNull,
} from './utils'

const MESSAGE_ATTRIBUTES = {
  smsType: 'AWS.SNS.SMS.SMSType',
  senderId: 'AWS.SNS.SMS.SenderID'
}

const SMS_PRIORITY = {
  high: 'Transactional',
  low: 'Promotional',
}

export class SNSUtils implements ISMS {
  private aws: AwsApis
  private logger: Logger
  constructor ({ aws, logger }: {
    aws: AwsApis
    logger: Logger
  }) {
    this.aws = aws
    this.logger = logger
  }

  public createTopic = async ({ name, region }) => {
    const { TopicArn } = await this._client(region).createTopic({ Name: name }).promise()
    return TopicArn
  }

  public deleteTopic = async (topic: string) => {
    this.logger.debug('deleting topic', { topic })
    await this._client(topic).deleteTopic({ TopicArn: topic }).promise()
  }

  public deleteAllSubscriptions = async (topic: string) => {
    this.logger.debug('deleting all subscriptions', { topic })
    const subs = await this.listSubscriptions({ topic })
    await Promise.all(subs.map(sub => this.unsubscribe(sub.SubscriptionArn)))
  }

  public getTopicAttributes = async (topic) => {
    const { region } = parseArn(topic)
    return await this._client(region).getTopicAttributes({ TopicArn: topic }).promise()
  }

  public setTopicAttributes = async (params: AWS.SNS.SetTopicAttributesInput) => {
    await this._client(params.TopicArn).setTopicAttributes(params).promise()
  }

  public subscribe = async ({ topic, endpoint, protocol }: {
    topic: string
    endpoint: string
    protocol: string
  }) => {
    const { SubscriptionArn } = await this._client(topic).subscribe({
      TopicArn: topic,
      Endpoint: endpoint,
      Protocol: protocol,
    }).promise()

    return SubscriptionArn
  }

  public unsubscribe = async (SubscriptionArn: string) => {
    await this._client(SubscriptionArn).unsubscribe({ SubscriptionArn }).promise()
  }

  public listSubscriptions = async ({ topic, filter=acceptAll }: {
    topic: string
    filter?: (sub: AWS.SNS.Subscription) => boolean
  }) => {
    const params: AWS.SNS.ListSubscriptionsByTopicInput = {
      TopicArn: topic
    }

    const sns = this._client(topic)
    let batch: AWS.SNS.ListSubscriptionsByTopicResponse
    let matches:AWS.SNS.Subscription[] = []
    do {
      batch = await sns.listSubscriptionsByTopic(params).promise()
      matches = matches.concat(batch.Subscriptions.filter(filter))
    } while (batch.NextToken)

    return matches
  }

  public subscribeIfNotSubscribed = async ({ topic, protocol, endpoint }: {
    topic: string
    protocol: 'email' | 'lambda'
    endpoint: string
  }) => {
    const existing = await this.listSubscriptions({
      topic,
      filter: sub => isMatch(sub, { Protocol: protocol, Endpoint: endpoint })
    })

    let sub: string
    if (existing.length) {
      sub = existing[0].SubscriptionArn
    } else {
      this.logger.debug(`subscribing ${protocol} to topic`, { endpoint, topic })
      sub = await this.subscribe({ topic, endpoint, protocol })
    }

    return sub
  }

  public publish = async ({ topic, subject, message }: {
    topic: string
    message: SNSMessage|string
    subject?: string
  }) => {
    const params:AWS.SNS.PublishInput = {
      TopicArn: topic,
      Subject: subject,
      Message: null,
    }

    if (typeof message === 'string') {
      params.Message = message
    } else {
      params.MessageStructure = 'json'
      params.Message = JSON.stringify({
        ...message,
        default: typeof message.default === 'string' ? message.default : JSON.stringify(message.default)
      })
    }

    await this._client(topic).publish(
      pickNonNull(params) as AWS.SNS.PublishInput
    ).promise()
  }

  public sendSMS = async ({ phoneNumber, message, senderId, highPriority }: ISendSMSOpts) => {
    const { callingCode, number } = parseE164(phoneNumber)
    const region = getAWSRegionByCallingCode(callingCode)
    const client = this.aws.create('SNS', region) as AWS.SNS
    this.logger.silly('sending SMS', { region, callingCode, number })
    const params: AWS.SNS.PublishInput = {
      PhoneNumber: callingCode + number,
      Message: message,
      MessageAttributes: {}
    }

    if (senderId) {
      params.MessageAttributes[MESSAGE_ATTRIBUTES.senderId] = { DataType: 'String', StringValue: 'Tradle' }
    }

    params.MessageAttributes[MESSAGE_ATTRIBUTES.smsType] = {
      DataType: 'String',
      StringValue: highPriority ? SMS_PRIORITY.high : SMS_PRIORITY.low,
    }

    await client.publish(params).promise()
  }

  private _client = (arnOrRegion?: string) => {
    if (!arnOrRegion) return this.aws.sns

    const region = arnOrRegion.startsWith('arn:aws') ? getArnRegion(arnOrRegion) : arnOrRegion
    return this.aws.regional[region].sns
  }
}

export default SNSUtils
export const genSetDeliveryPolicyParams = (TopicArn: string, policy: any):AWS.SNS.SetTopicAttributesInput => ({
  TopicArn,
  AttributeName: 'DeliveryPolicy',
  AttributeValue: JSON.stringify(policy)
})

export const genCrossAccountPublishPermission = (topic: string, accounts: string[]) => ({
  Sid: genStatementId('allowCrossAccountPublish'),
  Effect: 'Allow',
  Principal: {
    AWS: accounts
  },
  Action: 'SNS:Publish',
  Resource: topic
})


const getArnRegion = (arn: string) => parseArn(arn).region
