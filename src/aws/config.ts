import { AWSConfig, getLocalstackConfig } from "@tradle/aws-common-utils"
import merge from "lodash/merge"

export const createConfig = ({ region, local }: { region: string; local: boolean }): AWSConfig => {
  const config: AWSConfig = {
    maxRetries: 6,
    region,
    s3: {
      signatureVersion: "v4"
    },
    iotdata: {
      httpOptions: {
        connectTimeout: 10000,
        timeout: 10000
      }
    }
  }

  if (local) merge(config, getLocalstackConfig())

  return config
}
