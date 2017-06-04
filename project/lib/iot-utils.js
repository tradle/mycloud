
const { getIotData } = require('./aws')
const DEFAULT_QOS = 1

function publish (params) {
  if (!('qos' in params)) params.qos = DEFAULT_QOS

  return getIotData().then(iotData => iotData.publish(params).promise())
}

function sendMessage ({ clientId, message }) {
  return publish({
    topic: `${clientId}/message`,
    payload: message
  })
}

function sendChallenge ({ clientId, challenge }) {
  return publish({
    topic: `${clientId}/challenge`,
    payload: challenge
  })
}

function sendAuthenticated ({ clientId }) {
  return publish({
    topic: `${clientId}/authenticated`
  })
}

function getRegionFromEndpoint (iotEndpoint) {
  const partial = iotEndpoint.replace('.amazonaws.com', '');
  const iotIndex = iotEndpoint.indexOf('iot');
  return partial.substring(iotIndex + 4);
}

module.exports = {
  publish,
  sendMessage,
  sendChallenge,
  sendAuthenticated,
  getRegionFromEndpoint
}
