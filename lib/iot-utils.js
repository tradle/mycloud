
const debug = require('debug')('tradle:sls:iot')
const { co, clone } = require('./utils')
const DEFAULT_QOS = 1

module.exports = function ({ aws, prefix='' }) {

  function publish (params) {
    params = clone(params)
    if (!('qos' in params)) params.qos = DEFAULT_QOS

    if (typeof params.payload === 'object') {
      params.payload = JSON.stringify(params.payload)
    }

    debug(`publishing to ${params.topic}`)
    // : ${JSON.stringify(params)}`)
    return aws.iotData.publish(params).promise()
  }

  // function sendChallenge ({ clientId, challenge }) {
  //   return publish({
  //     topic: `${clientId}/challenge`,
  //     payload: challenge
  //   })
  // }

  // function sendAuthenticated ({ clientId }) {
  //   return publish({
  //     topic: `${clientId}/authenticated`
  //   })
  // }

  const getEndpoint = co(function* () {
    const { endpointAddress } = yield aws.iot.describeEndpoint().promise()
    return endpointAddress
  })

  // function getRegionFromEndpoint (iotEndpoint) {
  //   const partial = iotEndpoint.replace('.amazonaws.com', '');
  //   const iotIndex = iotEndpoint.indexOf('iot');
  //   return partial.substring(iotIndex + 4);
  // }

  const Iot = {
    publish,
    // sendMessages,
    // sendChallenge,
    // sendAuthenticated,
    // getRegionFromEndpoint,
    getEndpoint
  }

  return Iot
}
