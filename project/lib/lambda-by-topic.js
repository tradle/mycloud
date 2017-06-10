const {
  SERVERLESS_PREFIX
} = require('./env')

module.exports = {
  send: {
    FunctionName: `${SERVERLESS_PREFIX}send`,
    InvocationType: 'Event'
  },
  receive: {
    FunctionName: `${SERVERLESS_PREFIX}receive`,
    InvocationType: 'Event'
  },
  seal: {
    FunctionName: `${SERVERLESS_PREFIX}seal`,
    InvocationType: 'Event'
  },
  addcontact: {
    FunctionName: `${SERVERLESS_PREFIX}addcontact`,
    InvocationType: 'Event'
  }
}
