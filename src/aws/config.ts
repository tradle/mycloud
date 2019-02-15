import AWS from "aws-sdk"
import { FirstArgument } from "@tradle/aws-common-utils"

export interface AWSConfig extends FirstArgument<AWS.Config["update"]> {
  region: string // non-optional
}
export const createConfig = ({ region }: { region: string }): AWSConfig => {
  return {
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
}
