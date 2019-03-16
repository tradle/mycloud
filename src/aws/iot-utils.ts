import IotMessage from '@tradle/iot-message'
import { AwsApis, Env, Logger } from '../types'
const DEFAULT_QOS = 1

interface IotOpts {
  clients: AwsApis
  env: Env
  prefix?: string
}

interface IIotPublishOpts {
  topic: string
  payload: any
  qos?: 0 | 1
}

export default class Iot {
  private clients: AwsApis
  private logger: Logger
  constructor(private opts: IotOpts) {
    const { clients, env } = opts
    this.clients = clients
    this.logger = env.logger.sub('iot-utils')
  }

  public publish = async (params: IIotPublishOpts) => {
    params = { ...params }
    if (!('qos' in params)) params.qos = DEFAULT_QOS

    params.payload = await IotMessage.encode({
      type: 'messages',
      payload: params.payload,
      encoding: 'gzip'
    })

    this.logger.debug(`publishing to ${params.topic}`)
    await this.clients.iotdata.publish(params).promise()
  }

  public fetchEndpoint = async () => {
    this.logger.debug('fetching iot endpoint')
    const { endpointAddress } = await this.clients.iot
      .describeEndpoint({
        endpointType: 'iot:Data-ATS'
      })
      .promise()

    return endpointAddress
  }
}

export const createUtils = (opts: IotOpts) => new Iot(opts)

export { Iot }
