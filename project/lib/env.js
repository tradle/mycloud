const clone = require('xtend')
const {
  CF_ObjectsBucket,
  CF_SecretsBucket,
  CF_EventsTable,
  CF_InboxTable,
  CF_OutboxTable,
  CF_MessagesTable,
  CF_PubKeysTable,
  CF_PresenceTable,
  CF_IotClientRole,
  NETWORK_NAME='testnet',
  // SERVERLESS_STAGE,
  // SERVERLESS_SERVICE_NAME,
  SERVERLESS_PREFIX
} = process.env

module.exports = clone(require('../../env'), {
  ObjectsBucket: CF_ObjectsBucket,
  SecretsBucket: CF_SecretsBucket,
  EventsTable: CF_EventsTable,
  MessagesTable: CF_MessagesTable,
  InboxTable: CF_InboxTable,
  OutboxTable: CF_OutboxTable,
  PubKeysTable: CF_PubKeysTable,
  PresenceTable: CF_PresenceTable,
  IotClientRole: CF_IotClientRole,
  networkName: NETWORK_NAME,
  // serverlessStage: SERVERLESS_STAGE,
  // serverlessService: SERVERLESS_SERVICE_NAME,
  serverlessPrefix: SERVERLESS_PREFIX
})
