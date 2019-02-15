import AWS from "aws-sdk"
import IotMessage from "@tradle/iot-message"
import { mergeIntoAWSConfig } from "@tradle/aws-common-utils"
import { cachifyPromiser } from "./utils"
import { AwsApis, Env, Logger } from "./types"
const DEFAULT_QOS = 1

type IotOpts = {
  services: AwsApis
  env: Env
  prefix?: string
}

interface IIotPublishOpts {
  topic: string
  payload: any
  qos?: 0 | 1
}

export interface IIotEndpointInfo {
  parentTopic: string
  clientIdPrefix: string
}

const isATSEndpoint = endpoint => endpoint.includes("-ats.iot")

export default class Iot implements IIotEndpointInfo {
  public endpointInfo: IIotEndpointInfo
  public clientIdPrefix: string
  public parentTopic: string
  private services: AwsApis
  private logger: Logger
  private prefix: string
  private endpointReady: boolean
  constructor({ services, env, prefix = "" }: IotOpts) {
    this.services = services
    this.prefix = prefix
    this.logger = env.logger.sub("iot-utils")
    this.clientIdPrefix = env.IOT_CLIENT_ID_PREFIX
    this.parentTopic = env.IOT_PARENT_TOPIC
    this.endpointInfo = {
      parentTopic: this.parentTopic,
      clientIdPrefix: this.clientIdPrefix
    }
  }

  public publish = async (params: IIotPublishOpts) => {
    params = { ...params }
    if (!("qos" in params)) params.qos = DEFAULT_QOS

    params.payload = await IotMessage.encode({
      type: "messages",
      payload: params.payload,
      encoding: "gzip"
    })

    this.logger.debug(`publishing to ${params.topic}`)
    if (!this.endpointReady) {
      await this.getEndpoint()
      this.endpointReady = true
    }

    await this.services.iotdata.publish(params).promise()
  }

  public fetchEndpoint = async () => {
    const { endpointAddress } = await this.services.iot
      .describeEndpoint({
        endpointType: "iot:Data-ATS"
      })
      .promise()

    return endpointAddress
  }

  public getEndpoint = cachifyPromiser(async () => {
    // hack ./aws needs sync access to this var
    if (!AWS.config.iotdata.endpoint) {
      mergeIntoAWSConfig({
        iotdata: { endpoint: await this.fetchEndpoint() }
      })
    }

    return AWS.config.iotdata.endpoint
  })
}

export const createUtils = (opts: IotOpts) => new Iot(opts)

export { Iot }
