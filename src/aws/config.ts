import AWS from 'aws-sdk'
import { AWSConfig, getLocalstackConfig } from '@tradle/aws-common-utils'
import merge from 'lodash/merge'
import { Bot } from '../types'

interface CreateConfigOpts {
  region: string
  local: boolean
  iotEndpoint: string
}

export const createConfig = ({ region, local, iotEndpoint }: CreateConfigOpts): AWSConfig => {
  const config: AWSConfig = {
    maxRetries: 6,
    region,
    s3: {
      signatureVersion: 'v4'
    },
    iotdata: {
      httpOptions: {
        connectTimeout: 10000,
        timeout: 10000
      },
      endpoint: iotEndpoint
    }
  }

  if (local) merge(config, getLocalstackConfig())

  return config
}

export const useRealSES = (bot: Bot) => {
  const { endpoint } = bot.aws.ses
  // @ts-ignore
  bot.aws.ses.endpoint = `https://email.${AWS.config.region}.amazonaws.com`
  // return undo function
  return () => {
    bot.aws.ses.endpoint = endpoint
  }
}
