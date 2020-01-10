import https from 'https'
import AWS from 'aws-sdk'
import { HTTPOptions } from 'aws-sdk/lib/config'
import { AWSConfig, getLocalstackConfig } from '@tradle/aws-common-utils'
import merge from 'lodash/merge'
import { Bot } from '../types'
import { REGIONS } from '../mailer'

interface CreateConfigOpts {
  region: string
  local: boolean
  iotEndpoint: string
}

export const createConfig = ({ region, local, iotEndpoint }: CreateConfigOpts): AWSConfig => {
  const httpOptions: any = {
    keepAlive: true,
    maxSockets: 50,
    rejectUnauthorized: true
  }

  if (!local) {
    const agent = new https.Agent(httpOptions)
    // agent is an EventEmitter
    // @ts-ignore
    agent.setMaxListeners(0)
    httpOptions.agent = agent
  }
  let sesRegion
  if (region && REGIONS.includes(region)) sesRegion = region
  else {
    let parts = region.split('-')
    parts.pop()
    let partialRegion = parts.join('-')

    // let idx = region.lastIndexOf('-')
    // let partialRegion = region.slice(0, idx)
    sesRegion = REGIONS.find(r => r.startsWith(partialRegion))
    if (!sesRegion) {
      // partialRegion = partialRegion.split('-')[0]
      partialRegion = parts[0]
      sesRegion = REGIONS.find(r => r.startsWith(partialRegion))
    }
  }

  const config: AWSConfig = {
    maxRetries: 6,
    region,
    httpOptions,
    s3: {
      signatureVersion: 'v4'
    },
    ses: {
      region: sesRegion || region
    },
    iotdata: {
      httpOptions: {
        connectTimeout: 10000,
        timeout: 10000
      },
      endpoint: iotEndpoint
    }
  }

  if (local) {
    merge(config, getLocalstackConfig())
  }

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
