
const aws = require('./aws')
const DEFAULT_QOS = 1

function publish (params) {
  if (!('qos' in params)) params.qos = DEFAULT_QOS

  return aws.getIotData().then(iotData => iotData.publish(params).promise())
}

function sendMessages ({ clientId, payload }) {
  return publish({
    topic: getMessagesTopicForClient(clientId),
    payload: JSON.stringify(payload)
  })
}

function getMessagesTopicForClient (clientId) {
  return `${clientId}/message`
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

function getRegionFromEndpoint (iotEndpoint) {
  const partial = iotEndpoint.replace('.amazonaws.com', '');
  const iotIndex = iotEndpoint.indexOf('iot');
  return partial.substring(iotIndex + 4);
}

module.exports = {
  publish,
  sendMessages,
  // sendChallenge,
  // sendAuthenticated,
  getRegionFromEndpoint,
  getMessagesTopicForClient
}
