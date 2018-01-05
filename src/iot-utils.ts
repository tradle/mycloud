
import promisify = require('pify')
import IotMessage = require('@tradle/iot-message')
import { cachifyPromiser } from './utils'
const DEFAULT_QOS = 1

export = function createIotUtils ({ aws, env, prefix='' }) {

  const logger = env.logger.sub('iot-utils')
  // initialized lazily
  let iotData

  const publish = async (params) => {
    params = { ...params }
    if (!('qos' in params)) params.qos = DEFAULT_QOS

    params.payload = await IotMessage.encode({
      type: 'messages',
      payload: params.payload,
      encoding: 'gzip'
    })

    logger.debug(`publishing to ${params.topic}`)
    if (!iotData) {
      let endpoint = env.IOT_ENDPOINT
      if (!endpoint) {
        // HACK: set for ./aws to pick up
        env.IOT_ENDPOINT = await getEndpoint()
      }

      iotData = aws.iotData
    }

    return await iotData.publish(params).promise()
  }

  const getEndpoint = cachifyPromiser(async () => {
    if (env.IOT_ENDPOINT) return env.IOT_ENDPOINT

    const { endpointAddress } = await aws.iot.describeEndpoint().promise()
    return endpointAddress
  })

  const Iot = {
    publish,
    getEndpoint
  }

  return Iot
}
