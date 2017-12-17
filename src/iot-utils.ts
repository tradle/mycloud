
const promisify = require('pify')
const gzip = promisify(require('zlib').gzip)
const debug = require('debug')('tradle:sls:iot')
const { clone, cachifyPromiser } = require('./utils')
const DEFAULT_QOS = 1

module.exports = function ({ aws, env, prefix='' }) {

  // initialized lazily
  let iotData

  const publish = async (params) => {
    params = { ...params }
    if (!('qos' in params)) params.qos = DEFAULT_QOS

    let { payload } = params
    if (!(typeof payload === 'string' || Buffer.isBuffer(payload))) {
      payload = JSON.stringify(payload)
    }

    params.payload = await gzip(payload)
    debug(`publishing to ${params.topic}`)
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
