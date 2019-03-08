import { AWSConfig, getLocalstackConfig } from '@tradle/aws-common-utils'
import merge from 'lodash/merge'

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
