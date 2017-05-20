const {
  serverlessPrefix
} = require('./env')

module.exports = {
  send: {
    FunctionName: `${serverlessPrefix}send`,
    InvocationType: 'Event'
  },
  receive: {
    FunctionName: `${serverlessPrefix}receive`,
    InvocationType: 'Event'
  },
  seal: {
    FunctionName: `${serverlessPrefix}seal`,
    InvocationType: 'Event'
  },
  addcontact: {
    FunctionName: `${serverlessPrefix}addcontact`,
    InvocationType: 'Event'
  }
}
