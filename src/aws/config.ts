import { AWSServiceConfig } from "../types"
import { targetLocalstack } from "@tradle/aws-common-utils"

export const createConfig = ({
  region,
  local
}: {
  region: string
  local?: boolean
}): AWSServiceConfig => {
  const services = {
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
  } as AWSServiceConfig

  if (local) {
    targetLocalstack()
  }

  return services
}
